import {leagues,getJSON} from './games.js';
export default async function handler(req,res){
 const l=leagues.find(l=>l.id===req.query.league&&!l.college&&l.path);
 if(!l)return res.status(400).json({error:'Standings are not connected for this competition.'});
 try{
 const data=await getJSON('https://site.api.espn.com/apis/v2/sports/'+l.path+'/standings');
 const rows=[];function walk(n){for(const e of n.standings?.entries||[]){const stat=name=>e.stats?.find(s=>s.name===name)?.displayValue||'—';rows.push({name:e.team?.displayName||'TBD',logo:e.team?.logos?.[0]?.href||'',wins:stat('wins'),losses:stat('losses'),ties:stat('ties'),points:stat('points'),group:n.name||''});}for(const c of n.children||[])walk(c);}walk(data);
 res.setHeader('Cache-Control','s-maxage=600, stale-while-revalidate=1800');res.status(200).json({rows,updatedAt:new Date().toISOString()});
 }catch{res.status(503).json({error:'Standings are temporarily unavailable.'});}
}
