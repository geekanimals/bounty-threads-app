// Geek Influencer OS — roles, nav, KPI config. NO mock KPI values.
// Every number the dashboard shows is computed live from the database (app.js realKPIs()).

const ROLES = {
  owner: {
    label: "Agency Owner", initials: "AO", name: "Agency Owner",
    nav: ["dashboard","brands","campaigns","barter","celebrity","creators","irm","listening","finance","reports","approvals","settings"],
    ai: { title:"Owner Agent", sub:"Growth & revenue copilot" }
  },
  corporate: {
    label: "Corporate (Multi-Brand)", initials: "CO", name: "Corporate Admin",
    nav: ["dashboard","portfolio","campaigns","barter","celebrity","creators","irm","listening","reports","settings"],
    ai: { title:"Corporate Agent", sub:"Portfolio-wide intelligence" }
  },
  manager: {
    label: "Influencer / Celebrity Manager", initials: "MG", name: "Talent Manager",
    nav: ["dashboard","roster","campaigns","barter","celebrity","reports"],
    ai: { title:"Manager Agent", sub:"Books deals, manages talent" }
  },
  brand: {
    label: "Brand", initials: "BR", name: "Brand",
    nav: ["dashboard","campaigns","creators","irm","listening","approvals","reports"],
    ai: { title:"Brand Agent", sub:"Your campaign concierge" }
  },
  creator: {
    label: "Creator", initials: "CR", name: "Creator",
    nav: ["dashboard","marketplace","barter","growth","reports"],
    ai: { title:"Creator Agent", sub:"Your career coach" }
  }
};

const NAV_META = {
  dashboard:{ic:"🏠",label:"Dashboard"}, brands:{ic:"🏢",label:"Brand CRM"},
  portfolio:{ic:"🗂",label:"Portfolio"}, roster:{ic:"🎬",label:"My Roster"},
  campaigns:{ic:"📣",label:"Campaigns"}, marketplace:{ic:"🛒",label:"Marketplace"},
  barter:{ic:"📦",label:"Mass Barter"}, celebrity:{ic:"👑",label:"Celebrity Stories"},
  creators:{ic:"👥",label:"Creators"}, irm:{ic:"🤝",label:"IRM"},
  listening:{ic:"📡",label:"Listening"}, logistics:{ic:"🚚",label:"Logistics"},
  finance:{ic:"💰",label:"Finance"}, reports:{ic:"📊",label:"Reports"},
  approvals:{ic:"✅",label:"Approvals"}, growth:{ic:"🚀",label:"Growth"},
  settings:{ic:"⚙️",label:"Settings"}
};

// Which KPI cards each role shows. Values are computed live in app.js realKPIs().
const KPI_KEYS = {
  owner:     ["creators","activeCampaigns","liveBarters","emv"],
  corporate: ["brands","creators","activeCampaigns","emv"],
  manager:   ["creators","activeDeals","liveBarters","avgRating"],
  brand:     ["activeCampaigns","liveBarters","reach","approvals"],
  creator:   ["myBarters","growthScore","deadlines","completed"]
};

const KPI_META = {
  creators:{label:"Creators"}, brands:{label:"Brands"},
  activeCampaigns:{label:"Active Campaigns"}, liveBarters:{label:"Live Barters"},
  completed:{label:"Completed Barters"}, emv:{label:"EMV Generated"},
  reach:{label:"Est. Reach"}, approvals:{label:"Pending Approvals"},
  activeDeals:{label:"Active Deals"}, avgRating:{label:"Avg Talent Rating"},
  myBarters:{label:"My Barters"}, growthScore:{label:"Growth Score"},
  deadlines:{label:"Deadlines"}
};

// Aspirational (non-money) creator dream goals.
const DREAM_GOALS = [
  "Become a Verified Creator","Get Brand Deals Every Month","Become a Celebrity Creator",
  "Top Creator in My City","Grow to 100K Followers","Master Reels & Short-Form",
  "Build a Loyal Community","Become a Brand Ambassador","Get Featured by Big Brands"
];

// Contextual AI suggestions per role (fallback until OpenAI is wired).
const AI_SUGGEST = {
  owner:[{t:"Add your first creators",p:"Build your roster so campaigns can be matched."},{t:"Launch a barter campaign",p:"The Barter Engine is your fastest path to ROI."}],
  corporate:[{t:"Pool all brand creators",p:"Add campaigns per brand to build one unified DB."},{t:"Review portfolio health",p:"Track every brand's campaigns in one view."}],
  manager:[{t:"Add your talent roster",p:"Bring your creators in to start booking deals."},{t:"Match talent to open campaigns",p:"Apply your creators to live briefs."}],
  brand:[{t:"Review campaigns awaiting approval",p:"Approve briefs so sourcing can begin."},{t:"Watch your live content",p:"Track creators going live in real time."}],
  creator:[{t:"Pick your Dream Plan",p:"Choose a goal and get a personalized roadmap."},{t:"Browse open campaigns",p:"Apply to briefs that fit your niche."}]
};


// ---- Demo/fallback data (shown when Supabase isn't connected; live data replaces it) ----
const KPIS = {
  owner:     [{label:"Creators",val:"128",dir:"up",trend:"12%"},{label:"Active Campaigns",val:"9",dir:"up",trend:"3"},{label:"Live Barters",val:"24",dir:"up",trend:"8%"},{label:"EMV Generated",val:"₹42.6L",dir:"up",trend:"18%"}],
  corporate: [{label:"Brands",val:"6",dir:"up",trend:"1"},{label:"Creators",val:"312",dir:"up",trend:"9%"},{label:"Active Campaigns",val:"21",dir:"up",trend:"5"},{label:"EMV Generated",val:"₹1.4Cr",dir:"up",trend:"22%"}],
  manager:   [{label:"Creators",val:"18",dir:"up",trend:"2"},{label:"Active Deals",val:"7",dir:"up",trend:"3"},{label:"Live Barters",val:"5",dir:"down",trend:"1"},{label:"Avg Talent Rating",val:"4.7",dir:"up",trend:"0.2"}],
  brand:     [{label:"Active Campaigns",val:"4",dir:"up",trend:"1"},{label:"Live Barters",val:"12",dir:"up",trend:"4"},{label:"Est. Reach",val:"3.2M",dir:"up",trend:"14%"},{label:"Pending Approvals",val:"3",dir:"down",trend:"2"}],
  creator:   [{label:"My Barters",val:"5",dir:"up",trend:"2"},{label:"Growth Score",val:"82",dir:"up",trend:"6"},{label:"Deadlines",val:"2",dir:"down",trend:"1"},{label:"Completed Barters",val:"17",dir:"up",trend:"3"}]
};

const NOTIFS = {
  owner:     [{d:"good",t:"Barter batch went live",s:"Nykaa × 12 creators — shipping now"},{d:"brand",t:"New creator applied",s:"Aarav Mehta · 84K followers · Fashion"},{d:"warn",t:"Campaign needs approval",s:"boAt Summer Push awaiting your sign-off"}],
  corporate: [{d:"good",t:"Portfolio milestone",s:"EMV crossed ₹1Cr across 6 brands"},{d:"brand",t:"New campaign launched",s:"Mamaearth Monsoon — 40 creators"},{d:"warn",t:"Budget alert",s:"Plum campaign at 85% of budget"}],
  manager:   [{d:"good",t:"Deal booked",s:"Sanya × Sugar Cosmetics — ₹1.2L"},{d:"brand",t:"New brief matched",s:"2 of your creators fit the Zomato brief"},{d:"warn",t:"Deadline soon",s:"Rohit's reel due in 2 days"}],
  brand:     [{d:"good",t:"Creators going live",s:"3 reels publishing today"},{d:"brand",t:"Content submitted",s:"Ishita uploaded a draft for review"},{d:"warn",t:"Approval pending",s:"Your Summer campaign needs sign-off"}],
  creator:   [{d:"good",t:"You got selected!",s:"Nykaa barter — product ships this week"},{d:"brand",t:"New brief for you",s:"boAt is looking for tech creators"},{d:"warn",t:"Deadline reminder",s:"Submit your reel by Friday"}]
};

const BARTER = {
  "Requested":    [{n:"Nykaa Lip Kit",s:"12 creators · Beauty"},{n:"boAt Earbuds",s:"8 creators · Tech"}],
  "Shipped":      [{n:"Mamaearth Combo",s:"15 creators · Skincare"}],
  "Content Live": [{n:"Sugar Matte Set",s:"9 creators · 4 reels live"}],
  "Completed":    [{n:"Plum Serum",s:"20 creators · EMV ₹6.4L"}]
};

const CREATORS = [
  {name:"Aarav Mehta",city:"Mumbai",tier:"Macro",followers:"842K",eng:"4.2%",cat:"Fashion",rating:"4.8"},
  {name:"Ishita Rao",city:"Bengaluru",tier:"Micro",followers:"128K",eng:"6.1%",cat:"Beauty",rating:"4.9"},
  {name:"Rohit Sharma",city:"Delhi",tier:"Macro",followers:"1.2M",eng:"3.4%",cat:"Tech",rating:"4.6"},
  {name:"Sanya Kapoor",city:"Pune",tier:"Micro",followers:"64K",eng:"7.3%",cat:"Lifestyle",rating:"4.9"},
  {name:"Kabir Nair",city:"Hyderabad",tier:"Nano",followers:"18K",eng:"9.0%",cat:"Food",rating:"4.7"}
];

const CAMPAIGNS = [
  {name:"Summer Glow Launch",status:"Live",brand:"Nykaa",type:"Barter + Paid",progress:72,creators:14},
  {name:"Monsoon Skincare",status:"In Production",brand:"Mamaearth",type:"Barter",progress:45,creators:22},
  {name:"Festive Tech Drop",status:"Sourcing",brand:"boAt",type:"Paid",progress:20,creators:8},
  {name:"Everyday Matte",status:"Approval",brand:"Sugar Cosmetics",type:"Barter",progress:5,creators:0}
];
