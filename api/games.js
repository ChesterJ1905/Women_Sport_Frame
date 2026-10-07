export const leagues = [
 {id:'wnba',name:'WNBA',sport:'Basketball',path:'basketball/wnba'},
 {id:'unrivaled',name:'Unrivaled',sport:'Basketball',env:'UNRIVALED_FEED_URL'},
 {id:'nwsl',name:'NWSL',sport:'Soccer',path:'soccer/usa.nwsl'},
 {id:'pwhl',name:'PWHL',sport:'Hockey',env:'PWHL_FEED_URL'},
 {id:'wsl',name:'Women’s Super League',sport:'Soccer',path:'soccer/eng.w.1'},
 {id:'uwcl',name:'Women’s Champions League',sport:'Soccer',path:'soccer/uefa.wchampions'},
 {id:'national',name:'National teams',sport:'Soccer',paths:['soccer/fifa.friendly.w','soccer/fifa.wwc','soccer/uefa.weuro','soccer/concacaf.w.gold']},
 {id:'march',name:'March Madness',sport:'Basketball',path:'basketball/womens-college-basketball',college:true},
 {id:'softball',name:'NCAA Softball',sport:'Softball',path:'baseball/college-softball',college:true},
 {id:'volleyball',name:'NCAA Volleyball',sport:'Volleyball',path:'volleyball/womens-college-volleyball',college:true},
 {id:'college-soccer',name:'NCAA Soccer',sport:'Soccer',path:'soccer/usa.ncaa.w.1',college:true},
 {id:'lacrosse',name:'NCAA Lacrosse',sport:'Lacrosse',path:'lacrosse/womens-college-lacrosse',college:true},
 {id:'college-hockey',name:'NCAA Hockey',sport:'Hockey',path:'hockey/womens-college-hockey',college:true},
 {id:'college-other',name:'Other NCAA championships',sport:'College',college:true,env:'NCAA_CHAMPIONSHIPS_FEED_URL'}
];
export async function getJSON(url) {
 const response=await fetch(url,{signal:AbortSignal.timeout(7500),headers:{Accept:'application/json'}});
 if(!response.ok) throw new Error('Feed unavailable');
 return response.json();
}
export function isChampionship(event, league) {
 const competitions=event.competitions||[];
 const text=[event.name,event.season?.slug,...competitions.flatMap(c=>[c.type?.text,c.type?.abbreviation,...(c.notes||[]).map(n=>n.headline)])].filter(Boolean).join(' ');
 if(league.id==='march') return /NCAA (Women.s )?(Tournament|Championship)|March Madness|Women.s (Final Four|NCAA Tournament)/i.test(text) && !/NIT|conference tournament/i.test(text);
 return /NCAA.*(Tournament|Championship)|College (World|Cup)|Women.s College World Series|WCWS|Frozen Four/i.test(text) && !/conference tournament/i.test(text);
}
export function normalize(event,league) {
 const c=event.competitions?.[0]; if(!c||c.competitors?.length!==2) return null;
 if(league.college&&!isChampionship(event,league)) return null;
 const team=side=>{const t=c.competitors.find(x=>x.homeAway===side);return t?{name:t.team?.displayName||t.team?.name||'TBD',short:t.team?.abbreviation||'TBD',logo:t.team?.logo||'',score:t.score==null?null:String(t.score)}:null;};
 const home=team('home'),away=team('away'); if(!home||!away) return null;
 const state=c.status?.type||event.status?.type||{};
 return {id:league.id+'-'+event.id,league:league.id,leagueName:league.name,sport:league.sport,college:!!league.college,date:c.date||event.date,home,away,status:state.completed?'final':state.state==='in'?'live':state.name==='STATUS_POSTPONED'?'postponed':state.name==='STATUS_CANCELED'?'cancelled':'scheduled',detail:state.shortDetail||state.detail||'',round:(c.notes||[]).map(n=>n.headline).join(' · '),broadcast:(c.broadcasts||[]).flatMap(b=>b.names||[]).join(', '),source:'ESPN',url:event.links?.find(l=>l.href?.startsWith('https://'))?.href||''};
}
function customGames(data,l) {
 if(!Array.isArray(data.games)) throw new Error('Invalid feed');
 return data.games.filter(g=>g.id&&Number.isFinite(Date.parse(g.date))&&g.home?.name&&g.away?.name&&['live','scheduled','final','postponed','cancelled'].includes(g.status)&&(!l.college||(g.postseason===true&&(l.id!=='march'||g.tournament==='NCAA')))).map(g=>({...g,id:l.id+'-'+g.id,league:l.id,leagueName:l.name,sport:l.sport,college:!!l.college,source:data.source||'Connected feed'}));
}
export default async function handler(req,res) {
 if(req.method!=='GET') return res.status(405).json({error:'Method not allowed'});
 const now=new Date(),dateKey=d=>d.toISOString().slice(0,10).replaceAll('-','');
 const start=new Date(now.getTime()-3*86400000),end=new Date(now.getTime()+8*86400000);
 const dates=dateKey(start)+'-'+dateKey(end);
 const result=await Promise.all(leagues.map(async l=>{
  if(l.env&&!process.env[l.env]) return {league:l.id,status:'not-connected',games:[]};
  try {
   if(l.env){const url=process.env[l.env];if(!url.startsWith('https://'))throw new Error();return {league:l.id,status:'connected',games:customGames(await getJSON(url),l)};}
   const paths=l.paths||[l.path];
   const feeds=await Promise.allSettled(paths.map(path=>getJSON('https://site.api.espn.com/apis/site/v2/sports/'+path+'/scoreboard?limit=200&dates='+dates)));
   const succeeded=feeds.filter(f=>f.status==='fulfilled');
   if(!succeeded.length)throw new Error();
   const games=succeeded.flatMap(f=>(f.value.events||[]).map(e=>normalize(e,l)).filter(Boolean));
   return {league:l.id,status:succeeded.length===feeds.length?'connected':'partial',games};
  }catch{return {league:l.id,status:'unavailable',games:[]};}
 }));
 const games=[...new Map(result.flatMap(r=>r.games).filter(g=>Date.parse(g.date)>=start.getTime()&&Date.parse(g.date)<=end.getTime()).map(g=>[g.id,g])).values()].sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
 res.setHeader('Cache-Control','s-maxage=45, stale-while-revalidate=90');
 res.status(200).json({updatedAt:now.toISOString(),games,coverage:result.map(({league,status})=>({league,status})),leagues:leagues.map(({path,paths,env,...l})=>l)});
}
