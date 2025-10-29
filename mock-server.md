# Mock Coder Endpoint for Local Testing

This is an optional minimal mock for manual testing. It can be served by any
static HTTP server that supports a tiny script.

## Quick approach: Node one-liner (PowerShell)

```powershell
# Start a tiny HTTP server on port 8999 that mocks essential endpoints
node -e "const http=require('http');http.createServer((req,res)=>{if(req.method==='OPTIONS'){res.statusCode=204;return res.end();}if(req.url.startsWith('/api/v2/workspaces')&&req.method==='GET'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({count:1,workspaces:[]}));}if(req.url.match(/\/api\/v2\/(users|organizations)\//)&&req.url.endsWith('/workspaces')&&req.method==='POST'){let body='';req.on('data',d=>body+=d);req.on('end',()=>{try{const w=JSON.parse(body||'{}');}catch(_){}res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({name:'mock-ws',owner_name:'me',latest_app_status:{uri:'http://localhost:8999/app/mock'}}));});}else{res.statusCode=404;res.end('not found');}}).listen(8999)"
```

- Set plugin Server URL to `http://localhost:8999` in "Coder Settings".
- Use "Test Connection", then create a workspace. A new tab will open pointing to the mock app.

## Notes
- This mock provides basic Coder API endpoints for testing.
- You can tailor the JSON responses to match your template expectations.
