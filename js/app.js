import * as THREE from "three";
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
let viewerSpace = null;

let products = [];
let currentProduct = null;
let selectedObject = null;
let placedObjects = [];

/*
  중요:
  배치 버튼을 눌렀을 때만 true.
  화면 터치 1회로 배치 후 false로 바꿔서
  이동/회전 버튼 클릭 시 새 모델이 복사 생성되는 문제를 막음.
*/
let isPlacementMode = false;

const gltfLoader = new GLTFLoader();
const modelCache = new Map();

init();

async function init() {
  try {
    setupThree();
    setupLights();
    setupReticle();
    bindEvents();
    await loadManifest();
    animate();
  } catch (err) {
    console.error("초기화 실패:", err);
    alert("초기화 실패: " + err.message);
  }
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

  /*
    일부 기기/브라우저에서 local-floor 미지원 오류 방지.
    삼성 인터넷/일부 안드로이드 브라우저에서 특히 필요.
  */
  renderer.xr.setReferenceSpaceType("local");

  renderer.outputColorSpace = THREE.SRGBColorSpace;

  document.body.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera();

  controller = renderer.xr.getController(0);

  /*
    AR 화면 터치 select 이벤트.
    배치 대기 모드일 때만 제품을 놓는다.
  */
  controller.addEventListener("select", () => {
    if (!isPlacementMode) return;

    placeCurrentProduct();
    isPlacementMode = false;
    updatePlaceButtonState();
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
  safeClick("startBtnBig", startAR);

  safeClick("loadBtn", async (event) => {
    stopUIEvent(event);
    await preloadCurrentProduct();
  });

  /*
    배치 버튼은 바로 배치하지 않고,
    배치 대기 모드만 켠다.
    실제 배치는 AR 화면 터치 select 이벤트에서 1회 실행.
  */
  safeClick("placeBtn", (event) => {
    stopUIEvent(event);

    if (!currentProduct) {
      showToast("제품을 먼저 선택하세요.");
      return;
    }

    isPlacementMode = true;
    updatePlaceButtonState();
    showToast("배치할 위치를 화면에서 한 번 터치하세요.");
  });

  safeClick("captureBtn", (event) => {
    stopUIEvent(event);
    captureScreen();
  });

  safeClick("clearBtn", (event) => {
    stopUIEvent(event);
    clearAll();
  });

  safeClick("moveForward", (event) => {
    stopUIEvent(event);
    moveSelected(0, -0.05);
  });

  safeClick("moveBack", (event) => {
    stopUIEvent(event);
    moveSelected(0, 0.05);
  });

  safeClick("moveLeft", (event) => {
    stopUIEvent(event);
    moveSelected(-0.05, 0);
  });

  safeClick("moveRight", (event) => {
    stopUIEvent(event);
    moveSelected(0.05, 0);
  });

  safeClick("rotateLeft", (event) => {
    stopUIEvent(event);
    rotateSelected(THREE.MathUtils.degToRad(15));
  });

  safeClick("rotateRight", (event) => {
    stopUIEvent(event);
    rotateSelected(THREE.MathUtils.degToRad(-15));
  });

  safeClick("heightUp", (event) => {
    stopUIEvent(event);
    heightSelected(0.05);
  });

  safeClick("heightDown", (event) => {
    stopUIEvent(event);
    heightSelected(-0.05);
  });

  if (dom.productSelect) {
    dom.productSelect.addEventListener("change", (event) => {
      stopUIEvent(event);

      const id = dom.productSelect.value;
      currentProduct = products.find((p) => p.id === id) || null;

      if (currentProduct) {
        showToast(`${currentProduct.name} 선택됨`);
      }
    });
  }

  if (dom.lockScale && dom.scaleRange) {
    dom.lockScale.addEventListener("change", (event) => {
      stopUIEvent(event);
      dom.scaleRange.disabled = dom.lockScale.checked;
    });
  }

  if (dom.scaleRange) {
    dom.scaleRange.addEventListener("input", (event) => {
      stopUIEvent(event);

      const pct = Number(dom.scaleRange.value);

      if (dom.scaleValue) {
        dom.scaleValue.textContent = `${pct}%`;
      }

      if (selectedObject && dom.lockScale && !dom.lockScale.checked) {
        const s = pct / 100;
        selectedObject.scale.setScalar(s);
      }
    });
  }

  /*
    UI가 아닌 캔버스 영역 터치 시, 기존 배치된 제품 선택용.
    UI 버튼 터치는 무시한다.
  */
  renderer.domElement.addEventListener("pointerdown", selectByPointer);
}

function safeClick(id, handler) {
  const el = document.getElementById(id);

  if (!el) {
    console.warn(`[버튼 없음] #${id}`);
    return;
  }

  el.addEventListener("click", handler);
  el.addEventListener("pointerdown", stopUIEvent);
  el.addEventListener("touchstart", stopUIEvent, { passive: false });
}

function stopUIEvent(event) {
  if (!event) return;

  event.stopPropagation();

  if (typeof event.preventDefault === "function") {
    event.preventDefault();
  }
}

async function loadManifest() {
  try {
    const res = await fetch("manifest.json", { cache: "no-store" });

    if (!res.ok) {
      throw new Error(`manifest.json 로드 실패: HTTP ${res.status}`);
    }

    const data = await res.json();

    if (!Array.isArray(data.products)) {
      throw new Error("manifest.json 안에 products 배열이 없습니다.");
    }

    products = data.products;

    if (!dom.productSelect) {
      throw new Error("#productSelect 요소가 없습니다.");
    }

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
      showToast("제품 목록 로드 완료");
    } else {
      showToast("등록된 제품이 없습니다.");
    }
  } catch (err) {
    console.error("manifest 로드 오류:", err);
    alert("manifest.json 로드 오류: " + err.message);
    showToast("manifest.json 로드 실패");
  }
}

async function startAR() {
  console.log("AR 시작 버튼 클릭됨");

  if (!navigator.xr) {
    alert("이 브라우저는 WebXR AR을 지원하지 않습니다. Android Chrome에서 테스트해주세요.");
    showToast("WebXR AR 미지원 브라우저입니다.");
    return;
  }

  try {
    const supported = await navigator.xr.isSessionSupported("immersive-ar");

    if (!supported) {
      alert("현재 기기/브라우저에서 AR이 지원되지 않습니다. Android Chrome + ARCore 지원 기기에서 테스트해주세요.");
      showToast("현재 기기에서 AR이 지원되지 않습니다.");
      return;
    }

    const session = await navigator.xr.requestSession("immersive-ar", {
      requiredFeatures: ["hit-test"],
      optionalFeatures: ["dom-overlay"],
      domOverlay: { root: document.body }
    });

    await renderer.xr.setSession(session);

    dom.startScreen?.classList.add("hidden");
    dom.topBar?.classList.add("show");

    if (dom.reticle) {
      dom.reticle.style.display = "block";
    }

    showToast("AR 시작됨. 바닥을 비춰주세요.");

    session.addEventListener("end", () => {
      hitTestSourceRequested = false;
      hitTestSource = null;
      viewerSpace = null;
      isPlacementMode = false;

      reticleObject.visible = false;

      if (dom.reticle) {
        dom.reticle.style.display = "none";
      }

      dom.topBar?.classList.remove("show");
      dom.startScreen?.classList.remove("hidden");
      updatePlaceButtonState();
    });
  } catch (err) {
    console.error("AR 시작 실패:", err);
    alert("AR 시작 실패: " + err.message);
    showToast("AR 시작 실패");
  }
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
    console.error("모델 로드 실패:", err);
    alert(
      "모델 로드 실패:\n" +
      currentProduct.file +
      "\n\n파일명과 manifest.json 경로를 확인하세요.\n\n" +
      err.message
    );
    showToast("모델 로드 실패");
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

    /*
      제품 GLB는 bottom-center / upright 기준으로 정리되어 있다는 전제.
      누워서 나오면 manifest.json에 rotationXDeg/YDeg/ZDeg 넣어서 보정 가능.
    */
    if (currentProduct.rotationXDeg) {
      model.rotation.x += THREE.MathUtils.degToRad(currentProduct.rotationXDeg);
    }

    if (currentProduct.rotationYDeg) {
      model.rotation.y += THREE.MathUtils.degToRad(currentProduct.rotationYDeg);
    }

    if (currentProduct.rotationZDeg) {
      model.rotation.z += THREE.MathUtils.degToRad(currentProduct.rotationZDeg);
    }

    if (dom.lockScale && !dom.lockScale.checked && dom.scaleRange) {
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
    console.error("모델 배치 실패:", err);
    alert("모델 배치 실패: " + err.message);
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

          /*
            중요:
            material을 새로 만들면 GLB 원래 색상/텍스처가 날아감.
            기존 재질 그대로 유지.
          */
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
      (err) => {
        console.error(`GLB 로드 실패: ${product.file}`, err);
        reject(err);
      }
    );
  });
}

function prepareMaterial(material) {
  if (material.map) {
    material.map.colorSpace = THREE.SRGBColorSpace;
    material.map.needsUpdate = true;
  }

  if (material.emissiveMap) {
    material.emissiveMap.colorSpace = THREE.SRGBColorSpace;
    material.emissiveMap.needsUpdate = true;
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
    dom.editPanel?.classList.remove("show");

    if (dom.editTitle) {
      dom.editTitle.textContent = "선택된 제품 없음";
    }

    return;
  }

  dom.editPanel?.classList.add("show");

  if (dom.editTitle) {
    dom.editTitle.textContent = obj.userData.productName || "선택된 제품";
  }

  const scalePct = Math.round(obj.scale.x * 100);

  if (dom.scaleRange) {
    dom.scaleRange.value = scalePct;
  }

  if (dom.scaleValue) {
    dom.scaleValue.textContent = `${scalePct}%`;
  }
}

function selectByPointer(event) {
  /*
    UI 버튼 터치는 3D 선택/배치로 넘기지 않는다.
  */
  if (
    event.target.closest("#topBar") ||
    event.target.closest("#editPanel") ||
    event.target.closest("#startScreen") ||
    event.target.closest("#toast") ||
    event.target.closest("#captureStrip")
  ) {
    return;
  }

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
  selectedObject = null;
  isPlacementMode = false;

  selectObject(null);
  updatePlaceButtonState();

  showToast("전체 삭제 완료");
}

function captureScreen() {
  try {
    const url = renderer.domElement.toDataURL("image/png");

    const img = document.createElement("img");
    img.src = url;

    img.addEventListener("click", () => {
      const win = window.open();

      if (win) {
        win.document.write(`<img src="${url}" style="max-width:100%">`);
      }
    });

    dom.captureStrip?.prepend(img);
    showToast("캡처 완료");
  } catch (err) {
    console.error("캡처 실패:", err);
    showToast("캡처 실패");
  }
}

function updatePlaceButtonState() {
  if (!dom.placeBtn) return;

  if (isPlacementMode) {
    dom.placeBtn.textContent = "📍 배치 대기중";
    dom.placeBtn.style.background = "rgba(34,197,94,.85)";
  } else {
    dom.placeBtn.textContent = "📍 배치";
    dom.placeBtn.style.background = "rgba(14,165,233,.75)";
  }
}

function animate() {
  renderer.setAnimationLoop(render);
}

function render(timestamp, frame) {
  if (frame) {
    handleHitTest(frame);
  }

  renderer.render(scene, camera);
}

function handleHitTest(frame) {
  const session = renderer.xr.getSession();

  if (!session) return;

  if (!hitTestSourceRequested) {
    hitTestSourceRequested = true;

    session.requestReferenceSpace("viewer")
      .then((space) => {
        viewerSpace = space;
        return session.requestHitTestSource({ space: viewerSpace });
      })
      .then((source) => {
        hitTestSource = source;
      })
      .catch((err) => {
        console.error("hit-test source 생성 실패:", err);
        showToast("바닥 인식 준비 실패: " + err.message);
      });

    session.addEventListener("end", () => {
      hitTestSourceRequested = false;
      hitTestSource = null;
      viewerSpace = null;
    });
  }

  if (!hitTestSource) return;

  const referenceSpace = renderer.xr.getReferenceSpace();

  if (!referenceSpace) return;

  const hitTestResults = frame.getHitTestResults(hitTestSource);

  if (hitTestResults.length) {
    const hit = hitTestResults[0];
    const pose = hit.getPose(referenceSpace);

    if (pose) {
      reticleObject.visible = true;
      reticleObject.matrix.fromArray(pose.transform.matrix);

      if (dom.reticle) {
        dom.reticle.style.display = "block";
      }
    }
  } else {
    reticleObject.visible = false;

    if (dom.reticle) {
      dom.reticle.style.display = "none";
    }
  }
}

function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);

  if (camera) {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
}

function showToast(message) {
  if (!dom.toast) {
    console.log("[toast]", message);
    return;
  }

  dom.toast.textContent = message;
  dom.toast.style.display = "block";

  clearTimeout(showToast.timer);

  showToast.timer = setTimeout(() => {
    dom.toast.style.display = "none";
  }, 1800);
}
