import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

import { chromium } from "playwright";

const [assetId, versionValue] = process.argv.slice(2);
const version = Number(versionValue);

if (!assetId || !Number.isInteger(version) || version < 1) {
  throw new Error("Uso: node scripts/export-catalog-usdz-poster.mjs <assetId> <version>");
}

const root = process.cwd();
const assetDir = join(root, "assets", "3d", assetId, `v${version}`);
const glbPath = join(assetDir, `${assetId}.glb`);
const pageHtml = `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#f4eee2}canvas{display:block}</style><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script></head><body><script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { USDZExporter } from "three/addons/exporters/USDZExporter.js";
const scene=new THREE.Scene(); scene.background=new THREE.Color(0xf4eee2);
const camera=new THREE.PerspectiveCamera(34,4/3,0.01,100);
const renderer=new THREE.WebGLRenderer({antialias:true}); renderer.setSize(800,600); renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap; renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.15; renderer.outputColorSpace=THREE.SRGBColorSpace; document.body.append(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xfff8ea,0x5a4638,2.1)); const key=new THREE.DirectionalLight(0xfff2da,3.4); key.position.set(3,5,4); key.castShadow=true; scene.add(key); const fill=new THREE.DirectionalLight(0xb9d8ff,1.1); fill.position.set(-4,2,2); scene.add(fill);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:0xeee5d6,roughness:1})); floor.rotation.x=-Math.PI/2; floor.receiveShadow=true; scene.add(floor);
const model=(await new GLTFLoader().loadAsync("/model.glb")).scene; model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true}}); scene.add(model);
const box=new THREE.Box3().setFromObject(model); const size=box.getSize(new THREE.Vector3()); const center=box.getCenter(new THREE.Vector3()); const max=Math.max(size.x,size.y,size.z); const direction=new THREE.Vector3(1.3,0.8,1.5).normalize(); const vertical=size.y/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))); const horizontal=size.x/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*camera.aspect); const distance=Math.max(vertical,horizontal,max)*1.65; camera.position.copy(center).addScaledVector(direction,distance); camera.lookAt(center.x,center.y+size.y*0.02,center.z); camera.near=max/100; camera.far=max*100; camera.updateProjectionMatrix(); renderer.render(scene,camera);
window.exportUsdz=async()=>{const bytes=await new USDZExporter().parseAsync(model,{quickLookCompatible:true}); return await new Promise(resolve=>{const reader=new FileReader(); reader.onload=()=>resolve(reader.result.split(",")[1]); reader.readAsDataURL(new Blob([bytes]));});}; document.body.dataset.ready="true";
</script></body></html>`;

const server = createServer(async (request, response) => {
  try {
    if (request.url === "/") {
      response.setHeader("Content-Type", "text/html");
      response.end(pageHtml);
      return;
    }
    const path = request.url === "/model.glb" ? glbPath : join(root, request.url ?? "/");
    response.setHeader("Content-Type", extname(path) === ".js" ? "text/javascript" : "model/gltf-binary");
    response.end(await readFile(path));
  } catch {
    response.statusCode = 404;
    response.end();
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(`http://127.0.0.1:${address.port}/`);
  await page.waitForSelector('body[data-ready="true"]');
  await page.screenshot({ path: join(assetDir, "poster.png") });
  const usdzBase64 = await page.evaluate(() => window.exportUsdz());
  await writeFile(join(assetDir, `${assetId}.usdz`), Buffer.from(usdzBase64, "base64"));
} finally {
  await browser.close();
  server.close();
}

console.log(`Exportados USDZ y poster para ${assetId} v${version}`);
