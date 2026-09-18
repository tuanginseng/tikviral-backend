const { ProxyAgent } = require('undici');

async function run() {
  const proxyUrl = "http://FbDPC:wRVwE@171.236.166.164:50117";
  const dispatcher = new ProxyAgent(proxyUrl);
  
  try {
    const res = await fetch("https://api.ipify.org?format=json", { dispatcher });
    const data = await res.json();
    console.log("Global fetch IP with undici ProxyAgent:", data);
  } catch (e) {
    console.error("Global fetch error:", e);
  }
}
run();
