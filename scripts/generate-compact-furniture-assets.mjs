import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

import { mkdir, writeFile } from "node:fs/promises";
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Scene,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { USDZExporter } from "three/addons/exporters/USDZExporter.js";
import { chromium } from "playwright";

class NodeFileReader {
  result = null;
  onloadend = null;

  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
    });
  }

  readAsDataURL(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = `data:${blob.type};base64,${Buffer.from(result).toString("base64")}`;
      this.onloadend?.();
    });
  }
}

globalThis.FileReader ??= NodeFileReader;

const wood = new MeshStandardMaterial({ color: 0x6f321f, metalness: 0, roughness: 0.48 });
const woodTop = new MeshStandardMaterial({ color: 0xb96c3b, metalness: 0, roughness: 0.4 });
const linen = new MeshStandardMaterial({ color: 0xd8c5a5, metalness: 0, roughness: 0.82 });
const brass = new MeshStandardMaterial({ color: 0xb68b3e, metalness: 0.72, roughness: 0.28 });

function box(parent, name, size, position, material, radius = 0) {
  const geometry = radius > 0 ? new RoundedBoxGeometry(...size, 4, radius) : new BoxGeometry(...size);
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}

function cylinder(parent, name, radii, height, position, material) {
  const mesh = new Mesh(new CylinderGeometry(radii[0], radii[1], height, 20), material);
  mesh.name = name;
  mesh.position.set(...position);
  parent.add(mesh);
  return mesh;
}

function createTable() {
  const model = new Group();
  model.name = "Mesa auxiliar compacta";
  box(model, "Tablero biselado", [0.6, 0.045, 0.45], [0, 0.5275, 0], woodTop, 0.018);
  box(model, "Cajón", [0.48, 0.105, 0.34], [0, 0.4525, 0], wood, 0.012);
  cylinder(model, "Tirador", [0.012, 0.012], 0.12, [0, 0.46, 0.177], brass).rotation.z = Math.PI / 2;
  box(model, "Repisa inferior", [0.46, 0.025, 0.31], [0, 0.14, 0], woodTop, 0.01);
  for (const x of [-0.255, 0.255]) {
    for (const z of [-0.18, 0.18]) {
      cylinder(model, "Pata torneada", [0.022, 0.032], 0.43, [x, 0.215, z], wood);
    }
  }
  return model;
}

function createChair() {
  const model = new Group();
  model.name = "Silla tapizada compacta";
  model.position.z = 0.0085;
  box(model, "Asiento tapizado", [0.48, 0.09, 0.46], [0, 0.47, 0.005], linen, 0.035);
  const back = box(model, "Espaldar tapizado", [0.48, 0.4, 0.075], [0, 0.7, -0.2025], linen, 0.035);
  back.rotation.x = -0.06;
  for (const x of [-0.205, 0.205]) {
    for (const z of [-0.17, 0.17]) {
      const rear = z < 0;
      cylinder(
        model,
        rear ? "Pata trasera" : "Pata delantera",
        [0.018, 0.025],
        rear ? 0.82 : 0.425,
        [x, rear ? 0.41 : 0.2125, z],
        wood,
      );
    }
  }
  box(model, "Travesaño frontal", [0.38, 0.025, 0.025], [0, 0.2, 0.17], wood, 0.008);
  box(model, "Travesaño lateral izquierdo", [0.025, 0.025, 0.31], [-0.205, 0.2, 0], wood, 0.008);
  box(model, "Travesaño lateral derecho", [0.025, 0.025, 0.31], [0.205, 0.2, 0], wood, 0.008);
  return model;
}

async function exportModel(assetId, version, model) {
  const outputDir = join(process.cwd(), "assets", "3d", assetId, `v${version}`);
  const scene = new Scene();
  scene.add(model);
  await mkdir(outputDir, { recursive: true });
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
  const usdz = await new USDZExporter().parseAsync(scene, { quickLookCompatible: true });
  await Promise.all([
    writeFile(join(outputDir, `${assetId}.glb`), Buffer.from(glb)),
    writeFile(join(outputDir, `${assetId}.usdz`), Buffer.from(usdz)),
  ]);
  return { assetId, version, outputDir };
}

const renderPage = `<!doctype html><html><head><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#f4eee2}canvas{display:block}</style><script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script></head><body><script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
const params=new URLSearchParams(location.search); const src=params.get("src");
const scene=new THREE.Scene(); scene.background=new THREE.Color(0xf4eee2);
const camera=new THREE.PerspectiveCamera(34,4/3,0.01,100);
const renderer=new THREE.WebGLRenderer({antialias:true}); renderer.setSize(800,600); renderer.setPixelRatio(1); renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap; renderer.toneMapping=THREE.ACESFilmicToneMapping; renderer.toneMappingExposure=1.15; renderer.outputColorSpace=THREE.SRGBColorSpace; document.body.append(renderer.domElement);
scene.add(new THREE.HemisphereLight(0xfff8ea,0x5a4638,2.1)); const key=new THREE.DirectionalLight(0xfff2da,3.4); key.position.set(3,5,4); key.castShadow=true; key.shadow.mapSize.set(2048,2048); scene.add(key); const fill=new THREE.DirectionalLight(0xb9d8ff,1.1); fill.position.set(-4,2,2); scene.add(fill);
const floor=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:0xeee5d6,roughness:1})); floor.rotation.x=-Math.PI/2; floor.receiveShadow=true; scene.add(floor);
const gltf=await new GLTFLoader().loadAsync(src); const model=gltf.scene; model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true}}); scene.add(model);
const box=new THREE.Box3().setFromObject(model); const size=box.getSize(new THREE.Vector3()); const center=box.getCenter(new THREE.Vector3()); const max=Math.max(size.x,size.y,size.z); const direction=new THREE.Vector3(1.3,0.8,1.5).normalize(); const vertical=size.y/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))); const horizontal=size.x/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*camera.aspect); const distance=Math.max(vertical,horizontal,max)*1.65; camera.position.copy(center).addScaledVector(direction,distance); camera.lookAt(center.x,center.y+size.y*0.02,center.z); camera.near=max/100; camera.far=max*100; camera.updateProjectionMatrix();
renderer.render(scene,camera); document.body.dataset.ready="true";
</script></body></html>`;

async function createPosters(assets) {
  const root = process.cwd();
  const server = createServer(async (request, response) => {
    try {
      if (request.url?.startsWith("/render")) {
        response.setHeader("Content-Type", "text/html");
        response.end(renderPage);
        return;
      }
      const path = join(root, decodeURIComponent(request.url?.split("?")[0] ?? "/"));
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
    for (const asset of assets) {
      const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
      const src = `/assets/3d/${asset.assetId}/v${asset.version}/${asset.assetId}.glb`;
      await page.goto(`http://127.0.0.1:${address.port}/render?src=${encodeURIComponent(src)}`);
      await page.waitForSelector('body[data-ready="true"]');
      await page.screenshot({ path: join(asset.outputDir, "poster.png") });
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
}

const assets = await Promise.all([
  exportModel("mesa-auxiliar", 2, createTable()),
  exportModel("silla", 1, createChair()),
]);
await createPosters(assets);
console.log("Activos generados: mesa-auxiliar v2 y silla v1");
