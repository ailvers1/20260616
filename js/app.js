import * as THREE from "three";
import { ARButton } from "three/addons/webxr/ARButton.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const $ = (id) => document.getElementById(id);

const dom = {
  startScreen: $("startScreen"),
  startBtnBig: $("startBtnBig"),
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
let reticleObject;

let hitTestSource = null;
let hitTestSourceRequested = false;

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
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera();

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

function bindEvents() {
  dom.startBtnBig.addEventListener("click", startAR);

  dom.loadBtn.addEventListener("click", async () => {
    await preloadCurrentProduct();
  });

  dom.placeBtn.addEventListener("click", () => {
    placeCurrentProduct();
  });

  dom.captureBtn.addEventListener("click", captureScreen);

  dom.clearBtn.addEventListener("click", clearAll);

  dom.productSelect.addEventListener("change", () => {
    const id = dom.productSelect.value;
    currentProduct = products.find((p) => p.id === id) || null;
    showToast(`${currentProduct?.name || "제품"} 선택됨`);
  });

  dom.lockScale.addEventListener("change", () => {
    dom.scaleRange.disabled = dom.lockScale.checked;
  });

  dom.scaleRange.addEventListener("input", () => {
    const pct = Number(dom.scaleRange.value);
    dom.scaleValue.textContent = `${pct}%`;

    if (selectedObject && !dom.lockScale.checked) {
      const s = pct / 100;
      selectedObject.scale.setScalar(s);
    }
  });

  dom.moveForward.addEventListener("click", () => moveSelected(0, -0.05));
  dom.moveBack.addEventListener("click", () => moveSelected(0, 0.05));
  dom.moveLeft.addEventListener("click", () => moveSelected(-0.05, 0));
  dom.moveRight.addEventListener("click", () => moveSelected(0.05, 0));

  dom.rotateLeft.addEventListener("click", () => rotateSelected(THREE.MathUtils.degToRad(15)));
  dom.rotateRight.addEventListener("click", () => rotateSelected(THREE.MathUtils.degToRad(-15)));

  dom.heightUp.addEventListener("click", () => heightSelected(0.05));
  dom.heightDown.addEventListener("click", () => heightSelected(-0.05));

  renderer.domElement.addEventListener("pointerdown", selectByPointer);
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
  if (!navigator.xr) {
    showToast("이 브라우저는 WebXR AR을 지원하지 않습니다.");
    return;
  }

  const supported = await navigator.xr.isSessionSupported("immersive-ar");

  if (!supported) {
    showToast("현재 기기/브라우저에서 AR이 지원되지 않습니다.");
    return;
  }

  const arButton = ARButton.createButton(renderer, {
    requiredFeatures: ["hit-test"],
    optionalFeatures: ["dom-overlay"],
    domOverlay: { root: document.body }
  });

  arButton.style.display = "none";
  document.body.appendChild(arButton);

  renderer.xr.addEventListener("sessionstart", () => {
    dom.startScreen.classList.add("hidden");
    dom.topBar.classList.add("show");
    dom.reticle.style.display = "block";
    showToast("바닥을 비추면 배치 위치가 표시됩니다.");
  });

  renderer.xr.addEventListener("sessionend", () => {
    hitTestSourceRequested = false;
    hitTestSource = null;
    reticleObject.visible = false;
    dom.reticle.style.display = "none";
    dom.topBar.classList.remove("show");
    dom.startScreen.classList.remove("hidden");
  });

  arButton.click();
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

  if (!reticleObject.visible) {
    showToast("바닥 인식 후 배치해주세요.");
    return;
  }

  try {
    const model = await loadModel(currentProduct);

    model.matrixAutoUpdate = true;
    model.position.setFromMatrixPosition(reticleObject.matrix);
    model.quaternion.setFromRotationMatrix(reticleObject.matrix);

    // 제품은 이미 bottom-center 기준으로 정리되어 있다는 전제.
    // 바닥에 눕는 경우만 여기에서 회전값 조정.
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

          // 중요:
          // 여기서 material을 새로 만들면 기존 GLB 색상/텍스처가 날아감.
          // 그래서 원래 재질을 그대로 유지한다.
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
  for (const obj of placedObjects) {
    scene.remove(obj);
  }

  placedObjects = [];
  selectObject(null);
  showToast("전체 삭제 완료");
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
  if (frame) {
    const session = renderer.xr.getSession();

    if (!hitTestSourceRequested) {
      session.requestReferenceSpace("viewer").then((referenceSpace) => {
        session.requestHitTestSource({ space: referenceSpace }).then((source) => {
          hitTestSource = source;
        });
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
