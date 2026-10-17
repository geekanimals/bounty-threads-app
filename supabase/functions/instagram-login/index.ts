import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { openRow, openToken, sealToken, tokenEncryptionOn } from "../_shared/token_crypto.ts";
import { corsHeaders, json } from "../_shared/cors.ts";
import { fetchProfileBundle } from "../_shared/ig.ts";
const IG_APP_ID=Deno.env.get("INSTAGRAM_APP_ID")!, IG_APP_SECRET=Deno.env.get("INSTAGRAM_APP_SECRET")!;
const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!, SERVICE_ROLE=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRAPH="https://graph.instagram.com";
Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  if(req.method!=="POST") return json({error:"Method not allowed"},405);
  let stage="start";
  try{
    const {code,redirect_uri,ticket}=await req.json();
    if(!code||!redirect_uri) return json({error:"Missing code or redirect_uri"},400);
    stage="token_exchange";
    const form=new FormData(); form.append("client_id",IG_APP_ID); form.append("client_secret",IG_APP_SECRET); form.append("grant_type","authorization_code"); form.append("redirect_uri",redirect_uri); form.append("code",code);
    const shortRes=await fetch("https://api.instagram.com/oauth/access_token",{method:"POST",body:form}); const shortData=await shortRes.json();
    if(!shortRes.ok||!shortData.access_token){console.error("IG_LOGIN token",JSON.stringify(shortData));return json({error:"Token exchange failed",detail:shortData},400);}
    stage="resolve_account";
    const meRes=await fetch(GRAPH+"/me?fields=user_id,username,account_type&access_token="+encodeURIComponent(shortData.access_token)); const meData=await meRes.json();
    if(!meRes.ok||!meData?.user_id){console.error("IG_LOGIN me",JSON.stringify(meData));return json({error:"Could not resolve Instagram account",detail:meData},400);}
    const igUserId=String(meData.user_id);
    stage="long_token";
    const longRes=await fetch(GRAPH+"/access_token?grant_type=ig_exchange_token&client_secret="+encodeURIComponent(IG_APP_SECRET)+"&access_token="+encodeURIComponent(shortData.access_token)); const longData=await longRes.json();
    const accessToken=longData.access_token||shortData.access_token; const expiresAt=new Date(Date.now()+(Number(longData.expires_in)||3600)*1000).toISOString();
    stage="profile";
    const {profile,media,avgReach,audience,mentions}=await fetchProfileBundle(accessToken,igUserId);
    if(profile?.error) return json({error:"Instagram profile fetch failed",detail:profile},400);
    // Came back from Instagram in a browser where nobody is signed in (phones: Instagram app → another browser)
    // but with the one-time ticket from the member who tapped "Connect" → connect to THAT member, never a new account.
    if(ticket){
      stage="ticket";
      const adminT=createClient(SUPABASE_URL,SERVICE_ROLE);
      const {data:mid,error:cErr}=await adminT.rpc("ig_connect_claim",{p_ticket:String(ticket)});
      if(cErr) throw new Error("ticket claim failed: "+cErr.message);
      if(!mid) return json({error:"This Instagram connect link has expired. Go back to Geek OS and tap Connect Instagram again."},410);
      const memberId=String(mid);
      const ids=[...new Set([igUserId,String(shortData.user_id||"")].filter(Boolean))];
      const {data:linked,error:lkErr}=await adminT.from("social_accounts").select("member_id").in("ig_user_id",ids).eq("platform","instagram").neq("member_id",memberId).limit(5);
      if(lkErr) throw new Error("existing connection check failed: "+lkErr.message);
      let merged=false;
      for(const row of linked??[]){
        const {data:m,error:mErr}=await adminT.rpc("ci_merge_ig_placeholder",{p_old:row.member_id,p_new:memberId});
        if(mErr||!m?.merged) return json({error:"This Instagram account is already connected to another login. Contact support if it's yours."},409);
        merged=true;
      }
      const {data:mem}=await adminT.from("members").select("org_id,role").eq("id",memberId).maybeSingle();
      const {error:saErr}=await adminT.from("social_accounts").upsert({org_id:mem?.org_id??null,member_id:memberId,platform:"instagram",ig_user_id:igUserId,username:profile.username??null,name:profile.name??null,account_type:profile.account_type??null,followers_count:profile.followers_count??0,follows_count:profile.follows_count??0,media_count:profile.media_count??0,profile_picture_url:profile.profile_picture_url??null,biography:profile.biography??null,website:profile.website??null,recent_media:media??[],avg_reach:avgReach,audience,mentions,updated_at:new Date().toISOString()},{onConflict:"member_id,platform"});
      if(saErr) throw new Error("social_accounts save failed: "+saErr.message);
      const {error:stErr}=await adminT.from("social_tokens").upsert({member_id:memberId,platform:"instagram",ig_user_id:igUserId,access_token:await sealToken(accessToken),expires_at:expiresAt,updated_at:new Date().toISOString()},{onConflict:"member_id,platform"});
      if(stErr) throw new Error("social_tokens save failed: "+stErr.message);
      const granted=Array.isArray(shortData.permissions)?shortData.permissions:String(shortData.permissions||"").split(",").map((x:string)=>x.trim()).filter(Boolean);
      try{ await adminT.from("social_tokens").update({scopes:granted.length?granted:null,connected_at:new Date().toISOString()}).eq("member_id",memberId).eq("platform","instagram"); }catch(_e){}
      // sign the creator in on this browser too (creators only — team accounts just get "connected")
      if(String(mem?.role||"")!=="creator") return json({ok:true,connected:true,merged,signin:false});
      stage="ticket_session";
      const {data:u,error:guErr}=await adminT.auth.admin.getUserById(memberId);
      if(guErr||!u?.user?.email) return json({ok:true,connected:true,merged,signin:false});
      const {data:lk,error:lnErr}=await adminT.auth.admin.generateLink({type:"magiclink",email:u.user.email});
      if(lnErr||!lk?.properties?.hashed_token) return json({ok:true,connected:true,merged,signin:false});
      return json({ok:true,connected:true,merged,token_hash:lk.properties.hashed_token});
    }
    stage="user_lookup";
    const admin=createClient(SUPABASE_URL,SERVICE_ROLE); const email="ig_"+igUserId+"@creators.bountythreads.app";
    let userId=null,userEmail=email;
    const {data:rows,error:lookupErr}=await admin.from("social_accounts").select("member_id,updated_at").eq("ig_user_id",igUserId).eq("platform","instagram").order("updated_at",{ascending:false}).limit(1);
    if(lookupErr) throw new Error("social_accounts lookup failed: "+lookupErr.message);
    const existing=rows?.[0];
    if(existing?.member_id){
      userId=existing.member_id; const {data:u,error:uErr}=await admin.auth.admin.getUserById(userId);
      if(uErr||!u?.user) throw new Error("Existing account lookup failed: "+(uErr?.message||"user missing")); userEmail=u.user.email||email;
    }else{
      const {data:created,error:cErr}=await admin.auth.admin.createUser({email,email_confirm:true,app_metadata:{created_via:"instagram-login"},user_metadata:{full_name:profile.name||profile.username||"Creator",org_name:profile.username?"@"+profile.username:"My Creator Space",role:"creator"}});
      if(created?.user) userId=created.user.id;
      else if(cErr?.code==="email_exists"){
        // Reuse the email owner only when this function created it. app_metadata is not user-settable.
        const {data:m,error:mErr}=await admin.from("members").select("id").eq("email",email).maybeSingle();
        if(mErr) throw new Error("Member lookup failed: "+mErr.message);
        const {data:o,error:oErr}=m?.id?await admin.auth.admin.getUserById(m.id):{data:null,error:null};
        if(oErr) throw new Error("Owner lookup failed: "+oErr.message);
        if(o?.user?.app_metadata?.created_via!=="instagram-login") return json({error:"Account conflict",stage},409);
        userId=o.user.id; userEmail=o.user.email||email;
      }else throw new Error("Create account failed: "+(cErr?.message||"unknown"));
    }
    stage="save";
    const {data:member}=await admin.from("members").select("org_id").eq("id",userId).maybeSingle();
    const {error:aErr}=await admin.from("social_accounts").upsert({org_id:member?.org_id??null,member_id:userId,platform:"instagram",ig_user_id:igUserId,username:profile.username??null,name:profile.name??null,account_type:profile.account_type??null,followers_count:profile.followers_count??0,follows_count:profile.follows_count??0,media_count:profile.media_count??0,profile_picture_url:profile.profile_picture_url??null,biography:profile.biography??null,website:profile.website??null,recent_media:media??[],avg_reach:avgReach,audience,mentions,updated_at:new Date().toISOString()},{onConflict:"member_id,platform"});
    if(aErr) throw new Error("social_accounts save failed: "+aErr.message);
    const {error:tErr}=await admin.from("social_tokens").upsert({member_id:userId,platform:"instagram",ig_user_id:igUserId,access_token:await sealToken(accessToken),expires_at:expiresAt,updated_at:new Date().toISOString()},{onConflict:"member_id,platform"});
    if(tErr) throw new Error("social_tokens save failed: "+tErr.message);
    stage="session";
    const {data:link,error:lErr}=await admin.auth.admin.generateLink({type:"magiclink",email:userEmail});
    if(lErr||!link?.properties?.hashed_token) throw new Error("Session link failed: "+(lErr?.message||"missing token_hash"));
    return json({ok:true,email:userEmail,token_hash:link.properties.hashed_token});
  }catch(e){console.error("IG_LOGIN_FATAL",JSON.stringify({stage,error:String(e)}));return json({error:"Instagram login failed",stage,detail:String(e)},500);}
});