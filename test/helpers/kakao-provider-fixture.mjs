// Loaded only by the isolated test child process. Production has fixed Kakao URLs.
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options={})=>{
 if(url==='https://kauth.kakao.com/oauth/token'){
  const code=new URLSearchParams(options.body).get('code');
  if(!/^fixture-\d+$/.test(code||''))return Response.json({error:'invalid_grant'},{status:400});
  return Response.json({access_token:code});
 }
 if(url==='https://kapi.kakao.com/v2/user/me')return Response.json({id:options.headers.Authorization.replace('Bearer fixture-','')});
 return originalFetch(url,options);
};
