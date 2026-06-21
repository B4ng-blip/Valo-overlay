/* VALORANT overlay relay server — pure Node, no dependencies.
   Run:  node server.js   (then open the URLs it prints)               */

const http = require("http");
const fs   = require("fs");
const path = require("path");

const PORT = process.env.PORT || 8080;
const PUBLIC = path.join(__dirname, "public");

// authoritative state lives here; control panel overwrites it, overlays read it
const { DEFAULT_STATE } = require("./public/shared.js");
let STATE = JSON.parse(JSON.stringify(DEFAULT_STATE));

const clients = new Set(); // SSE connections (overlays + panels)

const MIME = {".html":"text/html",".js":"text/javascript",".css":"text/css",
              ".png":"image/png",".jpg":"image/jpeg",".svg":"image/svg+xml",".ico":"image/x-icon"};

function broadcast(obj){
  const data = `data: ${JSON.stringify(obj)}\n\n`;
  for(const res of clients){ try{ res.write(data); }catch(e){ clients.delete(res); } }
}

function serveFile(res, file){
  fs.readFile(file,(err,buf)=>{
    if(err){ res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200,{"Content-Type":MIME[path.extname(file)]||"application/octet-stream"});
    res.end(buf);
  });
}

const server = http.createServer((req,res)=>{
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  // ---- SSE stream ----
  if(p==="/events"){
    res.writeHead(200,{
      "Content-Type":"text/event-stream","Cache-Control":"no-cache",
      "Connection":"keep-alive","Access-Control-Allow-Origin":"*"});
    res.write(`data: ${JSON.stringify({type:"full",state:STATE})}\n\n`);
    clients.add(res);
    const ka=setInterval(()=>{try{res.write(": keep-alive\n\n");}catch(e){}},20000);
    req.on("close",()=>{clearInterval(ka);clients.delete(res);});
    return;
  }

  // ---- current state snapshot ----
  if(p==="/state"){
    res.writeHead(200,{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"});
    return res.end(JSON.stringify(STATE));
  }

  // ---- receive update from control panel ----
  if(p==="/update" && req.method==="POST"){
    let body="";
    req.on("data",d=>{body+=d; if(body.length>1e6) req.destroy();});
    req.on("end",()=>{
      try{
        const msg=JSON.parse(body);
        if(msg.type==="full" && msg.state) STATE=msg.state;
        broadcast({type:"full",state:STATE});
        res.writeHead(200,{"Content-Type":"application/json"});res.end(`{"ok":true}`);
      }catch(e){res.writeHead(400);res.end(`{"ok":false}`);}
    });
    return;
  }

  // ---- static files ----
  let rel = p==="/" ? "/overlay.html" : p;
  if(p==="/control") rel="/control.html";
  if(p==="/overlay") rel="/overlay.html";
  const file = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[/\\])+/,""));
  if(!file.startsWith(PUBLIC)){res.writeHead(403);return res.end("Forbidden");}
  serveFile(res,file);
});

server.listen(PORT,()=>{
  const nets=require("os").networkInterfaces();
  let lan="localhost";
  for(const k in nets) for(const n of nets[k]) if(n.family==="IPv4"&&!n.internal) lan=n.address;
  console.log("\n  ┌─ VALORANT Overlay Server ─────────────────────────────");
  console.log("  │");
  console.log(`  │  OBS 브라우저 소스 URL :  http://localhost:${PORT}/overlay`);
  console.log(`  │  컨트롤 패널 (운영자)  :  http://localhost:${PORT}/control`);
  console.log(`  │  다른 기기(폰)에서 조작 :  http://${lan}:${PORT}/control`);
  console.log("  │");
  console.log("  └───────────────────────────────────────────────────────\n");
});
