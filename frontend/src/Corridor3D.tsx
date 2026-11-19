import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Health, Segment } from './state';

const HEALTH_HEX: Record<Health, number> = {
  'Very Poor': 0xb91c1c,
  Poor: 0xef4444,
  Fair: 0xf59e0b,
  Good: 0x22c55e,
};

// Interactive 3D model of the corridor: real road shape, PCI-coloured ribbons, PCI pillars.
export default function Corridor3D({ segments, onPick }: { segments: Segment[]; onPick: (s: Segment) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el || !segments.length) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setFailed(true);
      return;
    }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0b0d10, 70, 200);
    const camera = new THREE.PerspectiveCamera(42, el.clientWidth / el.clientHeight, 0.1, 400);
    camera.position.set(24, 21, 29);
    // Narrow (portrait) viewports need the camera farther back to fit the whole corridor.
    const BASE_DIST = camera.position.length();
    const fitDistance = () => camera.position.setLength(BASE_DIST * Math.max(1, 1.35 / camera.aspect));
    fitDistance();

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enableZoom = false; // keep page scroll working
    controls.enablePan = false;
    controls.minPolarAngle = 0.35;
    controls.maxPolarAngle = 1.25;
    controls.autoRotate = !reduced;
    controls.autoRotateSpeed = 0.6;

    scene.add(new THREE.HemisphereLight(0xdbe8ff, 0x101418, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(20, 40, 10);
    scene.add(sun);

    // Project lat/lon to local metres, then to scene units (1 unit = 50 m).
    const all = segments.flatMap(s => s.coords);
    const lat0 = all.reduce((a, c) => a + c[0], 0) / all.length;
    const lon0 = all.reduce((a, c) => a + c[1], 0) / all.length;
    const toXZ = ([lat, lon]: [number, number]) =>
      new THREE.Vector3(((lon - lon0) * 111320 * Math.cos((lat0 * Math.PI) / 180)) / 50, 0, (-(lat - lat0) * 110540) / 50);

    // Low-poly terrain with gentle hills, plus a blue survey grid.
    const ground = new THREE.PlaneGeometry(120, 120, 60, 60);
    ground.rotateX(-Math.PI / 2);
    const pos = ground.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const d = Math.min(1, Math.hypot(x, z) / 55);
      pos.setY(i, (Math.sin(x * 0.18) * Math.cos(z * 0.15) * 1.6 + Math.sin(x * 0.05 + z * 0.07) * 2.2) * d - 0.6);
    }
    ground.computeVertexNormals();
    scene.add(new THREE.Mesh(ground, new THREE.MeshStandardMaterial({ color: 0x1b2129, flatShading: true, roughness: 1 })));
    const grid = new THREE.GridHelper(120, 48, 0x0073cf, 0x1f3a55);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    grid.position.y = 0.05;
    scene.add(grid);

    const pickables: THREE.Object3D[] = [];
    const curves: THREE.CatmullRomCurve3[] = [];
    const disposables: { dispose: () => void }[] = [ground];

    segments.forEach((s, i) => {
      const pts = s.coords.map(c => toXZ(c).setY(0.6));
      if (pts.length < 2) return;
      const curve = new THREE.CatmullRomCurve3(pts);
      curves.push(curve);
      const color = HEALTH_HEX[s.health] ?? 0x22c55e;

      // Road ribbon: flattened tube on a dark kerb.
      const kerb = new THREE.TubeGeometry(curve, 160, 0.95, 6, false);
      const kerbMesh = new THREE.Mesh(kerb, new THREE.MeshStandardMaterial({ color: 0x0b0d10, roughness: 0.9 }));
      kerbMesh.scale.y = 0.35;
      scene.add(kerbMesh);
      const road = new THREE.TubeGeometry(curve, 160, 0.62, 8, false);
      const roadMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.5 });
      const roadMesh = new THREE.Mesh(road, roadMat);
      roadMesh.scale.y = 0.45;
      roadMesh.position.y = 0.25;
      roadMesh.userData.segment = s;
      scene.add(roadMesh);
      pickables.push(roadMesh);
      disposables.push(kerb, road, roadMat);

      // PCI pillar at the segment midpoint; height scales with PCI.
      const mid = curve.getPoint(0.5);
      const h = Math.max(1, s.pci / 6);
      const pillarGeo = new THREE.BoxGeometry(1.1, h, 1.1);
      const pillarMat = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.85, emissive: color, emissiveIntensity: 0.25 });
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(mid.x, h / 2 + 0.6, mid.z);
      pillar.userData.segment = s;
      scene.add(pillar);
      pickables.push(pillar);
      disposables.push(pillarGeo, pillarMat);

      // Label sprite above the pillar.
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 96;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'rgba(11,13,16,.88)';
      ctx.fillRect(0, 0, 256, 96);
      ctx.fillStyle = '#0073cf';
      ctx.fillRect(0, 0, 8, 96);
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 40px "Saira Condensed", Arial, sans-serif';
      ctx.fillText(`S0${i + 1} · PCI ${s.pci}`, 22, 46);
      ctx.fillStyle = '#9ca3af';
      ctx.font = '500 24px Manrope, Arial, sans-serif';
      ctx.fillText(s.health.toUpperCase(), 22, 80);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const spriteMat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.set(7.2, 2.7, 1);
      sprite.position.set(mid.x, h + 3, mid.z);
      sprite.renderOrder = 10;
      scene.add(sprite);
      disposables.push(tex, spriteMat);
    });

    // Survey marker travelling the whole corridor.
    const markerGeo = new THREE.SphereGeometry(0.55, 20, 20);
    const markerMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const marker = new THREE.Mesh(markerGeo, markerMat);
    const glow = new THREE.PointLight(0x5ab0ff, 30, 12);
    marker.add(glow);
    scene.add(marker);
    disposables.push(markerGeo, markerMat);

    // Click a road or pillar to open that segment.
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let down = { x: 0, y: 0 };
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const hit = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return ray.intersectObjects(pickables)[0]?.object.userData.segment as Segment | undefined;
    };
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return; // was a drag
      const s = hit(e);
      if (s) pickRef.current(s);
    };
    const onMove = (e: PointerEvent) => {
      renderer.domElement.style.cursor = hit(e) ? 'pointer' : 'grab';
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointermove', onMove);

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      fitDistance();
    });
    ro.observe(el);

    let raf = 0;
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(el);
    const clock = new THREE.Clock();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (!visible) return;
      const t = clock.getElapsedTime();
      if (curves.length) {
        const total = curves.length;
        const u = reduced ? 0.5 : (t * 0.05) % 1;
        const idx = Math.min(total - 1, Math.floor(u * total));
        const p = curves[idx].getPoint(u * total - idx);
        marker.position.set(p.x, 1.4 + Math.sin(t * 4) * 0.15, p.z);
      }
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointermove', onMove);
      disposables.forEach(d => d.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [segments]);

  return (
    <div className="corridor-3d" ref={host}>
      {failed && <p className="corridor-3d-fallback">3D view needs WebGL, which this browser has turned off.</p>}
    </div>
  );
}
