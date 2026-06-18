import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const $ = (id) => document.getElementById(id);

const dom = {
  startScreen: $("startScreen"),
  startBtnBig: $("startBtnBig"),
  previewBtnBig: $("previewBtnBig"),
  topBar: $("topBar"),
  productSelect: $("productSelect"),
  loadBtn: $("loadBtn"),
  placeBtn: $("placeBtn"),
  captureBtn: $("captureBtn"),
  clearBtn: $("clearBtn"),
  lockScale: $("lockScale"),
  scaleRange: $("scaleRange"),
  scaleValue: $("scaleValue"),
  reticle: $("reticle"),
  editPanel: $("editPanel"),
  editTitle: $("editTitle"),
  toast: $("toast"),
  captureStrip: $("captureStrip"),

  moveForward: $("moveForward"),
  moveBack: $("moveBack"),
  moveLeft: $("moveLeft"),
  moveRight: $("moveRight"),
  rotateLeft: $("rotateLeft"),
  rotateRight: $("rotateRight"),
  heightUp: $("heightUp"),
  heightDown: $("heightDown")
};

let renderer;
let scene;
let camera;
let controller;
let orbitControls;
let reticleObject;
let previewGrid;

let hitTestSource = null;
let hitTestSourceRequested = false;
let arReferenceSpaceType = "local";
let previewMode = false;

let products = [];
let currentProduct = null;
let selectedObject = null;
let placedObjects = [];

const gltfLoader = new GLTFLoader();
const modelCache = new Map();

init();

async function init() {
  setupThree();
  setupLights();
  setupReticle();
  setupPreviewHelpers();
  bindEvents();
  await loadManifest();
  animate();
}

function setupThree() {
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true
  });

  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local");
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 100);
  camera.position.set(0, 1.35, 3);

  orbitControls = new OrbitControls(camera, renderer.domElement);
  orbitControls.enabled = false;
  orbitControls.enableDamping = true;
  orbitControls.target.set(0, 0.95, 0);
  orbitControls.minDistance = 1.2;
  orbitControls.maxDistance = 5;
  orbitControls.maxPolarAngle = Math.PI * 0.48;

  controller = renderer.xr.getController(0);
  controller.addEventListener("select", () => {
    placeCurrentProduct();
  });
  scene.add(controller);

  window.addEventListener("resize", onResize);
}

function setupLights() {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.35);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 0.9);
  dir.position.set(1, 2, 1);
  scene.add(dir);
}

function setupReticle() {
  reticleObject = new THREE.Mesh(
    new THREE.RingGeometry(0.18, 0.22, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.9
    })
  );

  reticleObject.matrixAutoUpdate = false;
  reticleObject.visible = false;
  scene.add(reticleObject);
}

function setupPreviewHelpers() {
  previewGrid = new THREE.GridHelper(4, 20, 0x38bdf8, 0x334155);
  previewGrid.material.transparent = true;
  previewGrid.material.opacity = 0.35;
  previewGrid.visible = false;
  scene.add(previewGrid);
}

function bindEvents() {
  safeClick("startBtnBig", startAR);
  safeClick("previewBtnBig", () => {
    startPreview("3D 미리보기 모드입니다. 화면을 드래그해서 제품을 회전할 수 있습니다.");
  });

  safeClick("loadBtn", async () => {
    await preloadCurrentProduct();
  });

  safeClick("placeBtn", () => {
    placeCurrentProduct();
  });

  safeClick("captureBtn", captureScreen);

  safeClick("clearBtn", clearAll);

  safeClick("moveForward", () => moveSelected(0, -0.05));
  safeClick("moveBack", () => moveSelected(0, 0.05));
  safeClick("moveLeft", () => moveSelected(-0.05, 0));
  safeClick("moveRight", () => moveSelected(0.05, 0));

  safeClick("rotateLeft", () => rotateSelected(THREE.MathUtils.degToRad(15)));
  safeClick("rotateRight", () => rotateSelected(THREE.MathUtils.degToRad(-15)));

  safeClick("heightUp", () => heightSelected(0.05));
  safeClick("heightDown", () => heightSelected(-0.05));

  if (dom.productSelect) {
    dom.productSelect.addEventListener("change", () => {
      const id = dom.productSelect.value;
      currentProduct = products.find((p) => p.id === id) || null;
      showToast(`${currentProduct?.name || "제품"} 선택됨`);

      if (previewMode) {
        placePreviewProduct();
      }
    });
  }

  if (dom.lockScale && dom.scaleRange) {
    dom.lockScale.addEventListener("change", () => {
      dom.scaleRange.disabled = dom.lockScale.checked;
    });
  }

  if (dom.scaleRange) {
    dom.scaleRange.addEventListener("input", () => {
      const pct = Number(dom.scaleRange.value);
      dom.scaleValue.textContent = `${pct}%`;

      if (selectedObject && !dom.lockScale.checked) {
        const s = pct / 100;
        selectedObject.scale.setScalar(s);
      }
    });
  }

  renderer.domElement.addEventListener("pointerdown", selectByPointer);
}

function safeClick(id, handler) {
  const el = document.getElementById(id);

  if (!el) {
    console.warn(`[버튼 없음] #${id}`);
    return;
  }

  el.addEventListener("click", handler);
}

async function loadManifest() {
  try {
    const res = await fetch("manifest.json", { cache: "no-store" });

    if (!res.ok) {
      throw new Error(`manifest.json 로드 실패: ${res.status}`);
    }

    const data = await res.json();
    products = data.products || [];

    dom.productSelect.innerHTML = "";

    for (const product of products) {
      const option = document.createElement("option");
      option.value = product.id;
      option.textContent = `${product.name} (${Math.round(product.height * 1000)}mm)`;
      dom.productSelect.appendChild(option);
    }

    currentProduct = products[0] || null;

    if (currentProduct) {
      dom.productSelect.value = currentProduct.id;
    }

    showToast("제품 목록 로드 완료");
  } catch (err) {
    console.error(err);
    showToast("manifest.json을 불러오지 못했습니다.");
  }
}

async function startAR() {
  console.log("AR 시작 버튼 클릭됨");

  if (!navigator.xr) {
    alert("이 브라우저는 WebXR AR을 지원하지 않습니다. 3D 미리보기를 사용하거나 Android Chrome에서 다시 시도해주세요.");
    showToast("AR 미지원 브라우저입니다.");
    return;
  }

  try {
    const supported = await navigator.xr.isSessionSupported("immersive-ar");

    if (!supported) {
      alert("현재 기기/브라우저에서 AR이 지원되지 않습니다. 3D 미리보기를 사용하거나 Android Chrome + ARCore 지원 기기에서 다시 시도해주세요.");
      showToast("현재 기기에서 AR이 지원되지 않습니다.");
      return;
    }

    const session = await navigator.xr.requestSession("immersive-ar", {
      requiredFeatures: ["hit-test"],
      optionalFeatures: ["dom-overlay", "local-floor"],
      domOverlay: { root: document.body }
    });

    arReferenceSpaceType = await chooseReferenceSpaceType(session);
    renderer.xr.setReferenceSpaceType(arReferenceSpaceType);
    await renderer.xr.setSession(session);

    previewMode = false;
    orbitControls.enabled = false;
    previewGrid.visible = false;
    dom.startScreen.classList.add("hidden");
    dom.topBar.classList.add("show");
    dom.reticle.style.display = "block";

    showToast(`AR 시작됨. 바닥을 비춰주세요. (${arReferenceSpaceType})`);

    session.addEventListener("end", () => {
      hitTestSourceRequested = false;
      hitTestSource = null;
      reticleObject.visible = false;
      dom.reticle.style.display = "none";
      dom.topBar.classList.remove("show");
      dom.startScreen.classList.remove("hidden");
    });

  } catch (err) {
    console.error("AR 시작 실패:", err);
    alert("AR 시작 실패: " + err.message + "\n\n3D 미리보기 버튼으로 제품을 확인할 수 있습니다.");
    showToast("AR 시작 실패");
  }
}

async function chooseReferenceSpaceType(session) {
  for (const type of ["local-floor", "local"]) {
    try {
      await session.requestReferenceSpace(type);
      return type;
    } catch (err) {
      console.warn(`Reference space not available: ${type}`, err);
    }
  }

  throw new Error("이 기기에서 사용할 수 있는 AR 기준 좌표계를 찾지 못했습니다.");
}

async function startPreview(message) {
  previewMode = true;
  hitTestSourceRequested = false;
  hitTestSource = null;
  reticleObject.visible = false;
  previewGrid.visible = true;
  orbitControls.enabled = true;

  dom.startScreen.classList.add("hidden");
  dom.topBar.classList.add("show");
  dom.reticle.style.display = "none";

  await placePreviewProduct();
  showToast(message);
}

async function preloadCurrentProduct() {
  if (!currentProduct) {
    showToast("제품을 먼저 선택하세요.");
    return;
  }

  try {
    showToast("모델 불러오는 중...");
    await loadModel(currentProduct);
    showToast("모델 준비 완료");
  } catch (err) {
    console.error(err);
    showToast("모델 로드 실패. 경로와 파일명을 확인하세요.");
  }
}

async function placeCurrentProduct() {
  if (!currentProduct) {
    showToast("제품을 먼저 선택하세요.");
    return;
  }

  if (previewMode) {
    await placePreviewProduct();
    return;
  }

  if (!reticleObject.visible) {
    showToast("바닥 인식 후 배치해주세요.");
    return;
  }

  try {
    const model = await loadModel(currentProduct);

    model.matrixAutoUpdate = true;
    model.position.setFromMatrixPosition(reticleObject.matrix);
    model.quaternion.setFromRotationMatrix(reticleObject.matrix);

    if (currentProduct.rotationYDeg) {
      model.rotation.y += THREE.MathUtils.degToRad(currentProduct.rotationYDeg);
    }

    if (!dom.lockScale.checked) {
      const s = Number(dom.scaleRange.value) / 100;
      model.scale.setScalar(s);
    }

    model.userData.productId = currentProduct.id;
    model.userData.productName = currentProduct.name;

    scene.add(model);
    placedObjects.push(model);
    selectObject(model);

    showToast(`${currentProduct.name} 배치 완료`);
  } catch (err) {
    console.error(err);
    showToast("모델 배치 실패");
  }
}

async function placePreviewProduct() {
  if (!currentProduct) {
    showToast("제품을 먼저 선택하세요.");
    return;
  }

  try {
    clearPlacedObjects();

    const model = await loadModel(currentProduct);
    model.matrixAutoUpdate = true;
    model.position.set(0, 0, 0);

    if (currentProduct.rotationYDeg) {
      model.rotation.y += THREE.MathUtils.degToRad(currentProduct.rotationYDeg);
    }

    if (!dom.lockScale.checked) {
      const s = Number(dom.scaleRange.value) / 100;
      model.scale.setScalar(s);
    }

    model.userData.productId = currentProduct.id;
    model.userData.productName = currentProduct.name;

    scene.add(model);
    placedObjects.push(model);
    selectObject(model);
    framePreviewCamera(model);
  } catch (err) {
    console.error(err);
    showToast("3D 미리보기 로드 실패");
  }
}

function framePreviewCamera(model) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z, 1);

  orbitControls.target.copy(center);
  camera.position.set(center.x, center.y + radius * 0.35, center.z + radius * 1.8);
  camera.lookAt(center);
  orbitControls.update();
}

function loadModel(product) {
  if (modelCache.has(product.id)) {
    return Promise.resolve(cloneModel(modelCache.get(product.id)));
  }

  return new Promise((resolve, reject) => {
    gltfLoader.load(
      product.file,
      (gltf) => {
        const root = gltf.scene;

        root.traverse((child) => {
          if (!child.isMesh) return;

          child.castShadow = true;
          child.receiveShadow = true;

          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(prepareMaterial);
            } else {
              prepareMaterial(child.material);
            }
          }
        });

        modelCache.set(product.id, root);
        resolve(cloneModel(root));
      },
      undefined,
      reject
    );
  });
}

function prepareMaterial(material) {
  if (material.map) {
    material.map.colorSpace = THREE.SRGBColorSpace;
    material.map.needsUpdate = true;
  }

  material.needsUpdate = true;
}

function cloneModel(source) {
  const clone = source.clone(true);

  clone.traverse((child) => {
    if (!child.isMesh) return;

    if (Array.isArray(child.material)) {
      child.material = child.material.map((m) => m.clone());
    } else if (child.material) {
      child.material = child.material.clone();
    }
  });

  return clone;
}

function selectObject(obj) {
  selectedObject = obj;

  if (!obj) {
    dom.editPanel.classList.remove("show");
    dom.editTitle.textContent = "선택된 제품 없음";
    return;
  }

  dom.editPanel.classList.add("show");
  dom.editTitle.textContent = obj.userData.productName || "선택된 제품";

  const scalePct = Math.round(obj.scale.x * 100);
  dom.scaleRange.value = scalePct;
  dom.scaleValue.textContent = `${scalePct}%`;
}

function selectByPointer(event) {
  if (!placedObjects.length) return;

  const rect = renderer.domElement.getBoundingClientRect();

  const pointer = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, camera);

  const hits = raycaster.intersectObjects(placedObjects, true);

  if (!hits.length) {
    selectObject(null);
    return;
  }

  let target = hits[0].object;

  while (target.parent && !placedObjects.includes(target)) {
    target = target.parent;
  }

  selectObject(target);
}

function moveSelected(dx, dz) {
  if (!selectedObject) {
    showToast("이동할 제품을 선택하세요.");
    return;
  }

  selectedObject.position.x += dx;
  selectedObject.position.z += dz;
}

function rotateSelected(rad) {
  if (!selectedObject) {
    showToast("회전할 제품을 선택하세요.");
    return;
  }

  selectedObject.rotation.y += rad;
}

function heightSelected(dy) {
  if (!selectedObject) {
    showToast("높이를 조정할 제품을 선택하세요.");
    return;
  }

  selectedObject.position.y = Math.max(0, selectedObject.position.y + dy);
}

function clearAll() {
  clearPlacedObjects();
  selectObject(null);
  showToast("전체 삭제 완료");
}

function clearPlacedObjects() {
  for (const obj of placedObjects) {
    scene.remove(obj);
  }

  placedObjects = [];
}

function captureScreen() {
  try {
    const url = renderer.domElement.toDataURL("image/png");

    const img = document.createElement("img");
    img.src = url;
    img.addEventListener("click", () => {
      const win = window.open();
      win.document.write(`<img src="${url}" style="max-width:100%">`);
    });

    dom.captureStrip.prepend(img);
    showToast("캡처 완료");
  } catch (err) {
    console.error(err);
    showToast("캡처 실패");
  }
}

function animate() {
  renderer.setAnimationLoop(render);
}

function render(timestamp, frame) {
  if (previewMode) {
    orbitControls.update();
  }

  if (frame) {
    const session = renderer.xr.getSession();

    if (!hitTestSourceRequested) {
      getHitTestReferenceSpace(session).then((referenceSpace) => {
        session.requestHitTestSource({ space: referenceSpace }).then((source) => {
          hitTestSource = source;
        });
      }).catch((err) => {
        console.error("Hit-test reference space failed:", err);
        showToast("바닥 인식 기준을 만들지 못했습니다.");
      });

      session.addEventListener("end", () => {
        hitTestSourceRequested = false;
        hitTestSource = null;
      });

      hitTestSourceRequested = true;
    }

    if (hitTestSource) {
      const referenceSpace = renderer.xr.getReferenceSpace();
      const hitTestResults = frame.getHitTestResults(hitTestSource);

      if (hitTestResults.length) {
        const hit = hitTestResults[0];
        const pose = hit.getPose(referenceSpace);

        reticleObject.visible = true;
        reticleObject.matrix.fromArray(pose.transform.matrix);
        dom.reticle.style.display = "block";
      } else {
        reticleObject.visible = false;
        dom.reticle.style.display = "none";
      }
    }
  }

  renderer.render(scene, camera);
}

async function getHitTestReferenceSpace(session) {
  try {
    return await session.requestReferenceSpace("viewer");
  } catch (err) {
    console.warn("Viewer reference space unavailable. Falling back to AR reference space.", err);
    return session.requestReferenceSpace(arReferenceSpaceType);
  }
}

function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.style.display = "block";

  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    dom.toast.style.display = "none";
  }, 1800);
}
