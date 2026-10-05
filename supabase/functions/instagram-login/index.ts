import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
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
    const {code,redirect_uri}=await req.json();
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
      const {data:byEmail,error:eErr}=await admin.from("members").select("id,email").eq("email",email).maybeSingle();
      if(eErr) throw new Error("Member lookup failed: "+eErr.message);
      if(byEmail?.id){userId=byEmail.id;userEmail=byEmail.email||email;}
      else{
        const {data:created,error:cErr}=await admin.auth.admin.createUser({email,email_confirm:true,user_metadata:{full_name:profile.name||profile.username||"Creator",org_name:profile.username?"@"+profile.username:"My Creator Space",role:"creator"}});
        if(cErr||!created?.user) throw new Error("Create account failed: "+(cErr?.message||"unknown")); userId=created.user.id;
      }
    }
    stage="save";
    const {data:member}=await admin.from("members").select("org_id").eq("id",userId).maybeSingle();
    const {error:aErr}=await admin.from("social_accounts").upsert({org_id:member?.org_id??null,member_id:userId,platform:"instagram",ig_user_id:igUserId,username:profile.username??null,name:profile.name??null,account_type:profile.account_type??null,followers_count:profile.followers_count??0,follows_count:profile.follows_count??0,media_count:profile.media_count??0,profile_picture_url:profile.profile_picture_url??null,biography:profile.biography??null,website:profile.website??null,recent_media:media??[],avg_reach:avgReach,audience,mentions,updated_at:new Date().toISOString()},{onConflict:"member_id,platform"});
    if(aErr) throw new Error("social_accounts save failed: "+aErr.message);
    const {error:tErr}=await admin.from("social_tokens").upsert({member_id:userId,platform:"instagram",ig_user_id:igUserId,access_token:accessToken,expires_at:expiresAt,updated_at:new Date().toISOString()},{onConflict:"member_id,platform"});
    if(tErr) throw new Error("social_tokens save failed: "+tErr.message);
    stage="session";
    const {data:link,error:lErr}=await admin.auth.admin.generateLink({type:"magiclink",email:userEmail});
    if(lErr||!link?.properties?.hashed_token) throw new Error("Session link failed: "+(lErr?.message||"missing token_hash"));
    return json({ok:true,email:userEmail,token_hash:link.properties.hashed_token});
  }catch(e){console.error("IG_LOGIN_FATAL",JSON.stringify({stage,error:String(e)}));return json({error:"Instagram login failed",stage,detail:String(e)},500);}
});