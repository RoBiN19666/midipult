  /* ─────────── главная: 3D-станция ─────────── */
  var homeRingDots = [];
  var homeRingAngle = 0;

  function drawHomeScreen() {
    var canvas = document.getElementById('homeScreen');
    if (!canvas) return;
    if (canvas.width !== 512) {
      canvas.width = 512;
      canvas.height = 128;
    }
    var ctx = canvas.getContext('2d');
    var now = new Date();
    var text = (now.getHours() < 10 ? '0' : '') + now.getHours() +
      (now.getMinutes() < 10 ? '0' : '') + now.getMinutes();
    var masks = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc',
      '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abfgcd' };
    ctx.clearRect(0, 0, 512, 128);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#f4f1ff';
    ctx.shadowColor = 'rgba(170,145,255,.95)';
    ctx.shadowBlur = 10;
    function seg(x, y, w, h, name) {
      var p = {
        a: [x + 7, y + 4, x + w - 7, y + 4],
        b: [x + w - 4, y + 11, x + w - 4, y + h / 2 - 6],
        c: [x + w - 4, y + h / 2 + 6, x + w - 4, y + h - 11],
        d: [x + 7, y + h - 4, x + w - 7, y + h - 4],
        e: [x + 4, y + h / 2 + 6, x + 4, y + h - 11],
        f: [x + 4, y + 11, x + 4, y + h / 2 - 6],
        g: [x + 7, y + h / 2, x + w - 7, y + h / 2]
      }[name];
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(p[2], p[3]);
      ctx.stroke();
    }
    var xs = [66, 150, 304, 388];
    var frame = State.modelFrame;
    for (var i = 0; i < 4; i++) {
      var mask = frame ? (frame[i] || '') : (masks[text.charAt(i)] || '');
      for (var s = 0; s < mask.length; s++) seg(xs[i], 20, 58, 92, mask.charAt(s));
    }
    ctx.beginPath();
    ctx.arc(268, 48, 6, 0, Math.PI * 2);
    ctx.arc(268, 82, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#f4f1ff';
    ctx.fill();
    ctx.shadowBlur = 0;
    uploadHomeTexture();
    var gltfState = window.__stationGLTF;
    if (gltfState && gltfState.screenTexture) gltfState.screenTexture.needsUpdate = true;
  }

  function uploadHomeTexture() {
    var state = window.__stationGL;
    if (!state || !state.gl || !state.texture) return;
    var gl = state.gl;
    var canvas = document.getElementById('homeScreen');
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  }

  function initStationGLTF() {
    if (!window.THREE || !THREE.GLTFLoader) return false;
    var canvas = document.getElementById('stationGL');
    var stage = document.getElementById('stationStage');
    if (!canvas || !stage) return false;
    var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(stage.clientWidth || 600, stage.clientHeight || 500, false);
    if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    if (THREE.ACESFilmicToneMapping) renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(34, (stage.clientWidth || 600) / (stage.clientHeight || 500), 0.1, 100);
    scene.add(new THREE.HemisphereLight(0xdedbff, 0x101116, 0.7));
    var key = new THREE.DirectionalLight(0xfff5e8, 1.25);
    key.position.set(2.8, 4.5, 3.8);
    key.castShadow = true;
    scene.add(key);
    var fill = new THREE.DirectionalLight(0xdfe3ff, 0.35);
    fill.position.set(-3.5, 1.2, 2.2);
    scene.add(fill);
    var rim = new THREE.DirectionalLight(0xffffff, 0.3);
    rim.position.set(0, 2.5, -4.5);
    scene.add(rim);
    var state = { renderer: renderer, scene: scene, camera: camera, model: null,
      screenMesh: null, screenPlane: null, ringMaterials: [],
      yaw: 0.44, pitch: 0.16, distance: 6.55 };
    window.__stationGLTF = state;
    var drag = null;
    stage.addEventListener('pointerdown', function (event) {
      drag = { x: event.clientX, y: event.clientY, yaw: state.yaw, pitch: state.pitch };
      setPullRefresh(false);
      try { stage.setPointerCapture(event.pointerId); } catch (e) {}
    });
    stage.addEventListener('pointermove', function (event) {
      if (!drag) return;
      state.yaw = drag.yaw - (event.clientX - drag.x) * 0.007;
      state.pitch = Math.max(-0.25, Math.min(0.7, drag.pitch + (event.clientY - drag.y) * 0.004));
    });
    stage.addEventListener('pointerup', function () { drag = null; setPullRefresh(true); });
    stage.addEventListener('pointercancel', function () { drag = null; setPullRefresh(true); });
    stage.addEventListener('lostpointercapture', function () { drag = null; setPullRefresh(true); });
    stage.addEventListener('dblclick', function () { state.yaw = 0.44; state.pitch = 0.16; });
    function resize() {
      var w = stage.clientWidth || 600;
      var h = stage.clientHeight || 500;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
    else window.addEventListener('resize', resize);
    var loader = new THREE.GLTFLoader();
    loader.load('assets/scene.gltf', function (gltf) {
      var model = gltf.scene;
      scene.add(model);
      model.updateMatrixWorld(true);
      var screenMesh = null;
      var ringMesh = null;
      var ringMaterials = [];
      var bodyBox = new THREE.Box3();
      var bodyNodes = [];
      var bodyMaterials = [];
      var hasBody = false;
      var fc = document.createElement('canvas');
      fc.width = 256;
      fc.height = 256;
      var fx = fc.getContext('2d');
      fx.fillStyle = '#7b7e88';
      fx.fillRect(0, 0, 256, 256);
      for (var fy = 0; fy < 256; fy += 4) {
        fx.fillStyle = fy % 8 === 0 ? 'rgba(255,255,255,.025)' : 'rgba(0,0,0,.10)';
        fx.fillRect(0, fy, 256, 1);
      }
      for (var fxx = 0; fxx < 256; fxx += 4) {
        fx.fillStyle = fxx % 8 === 0 ? 'rgba(255,255,255,.018)' : 'rgba(0,0,0,.09)';
        fx.fillRect(fxx, 0, 1, 256);
      }
      var fseed = 987654321;
      for (var fn = 0; fn < 8000; fn++) {
        fseed = (fseed * 1664525 + 1013904223) >>> 0;
        var nx = fseed % 256;
        fseed = (fseed * 1664525 + 1013904223) >>> 0;
        var ny = fseed % 256;
        fx.fillStyle = (fseed & 1) ? 'rgba(255,255,255,.006)' : 'rgba(0,0,0,.045)';
        fx.fillRect(nx, ny, 1, 1);
      }
      var fabricTex = new THREE.CanvasTexture(fc);
      fabricTex.wrapS = THREE.RepeatWrapping;
      fabricTex.wrapT = THREE.RepeatWrapping;
      fabricTex.repeat.set(2, 2);
      if (THREE.sRGBEncoding) fabricTex.encoding = THREE.sRGBEncoding;
      model.traverse(function (node) {
        if (!node.isMesh) return;
        node.castShadow = true;
        node.receiveShadow = true;
        var mats = Array.isArray(node.material) ? node.material : [node.material];
        var name = (mats[0] && mats[0].name) || '';
        mats.forEach(function (mat) {
          if (!mat) return;
          mat.side = THREE.FrontSide;
          if (name === '.002') ringMaterials.push(mat);
          if (mat.emissive) {
            var lum = mat.emissive.r + mat.emissive.g + mat.emissive.b;
            if (lum > 0.25) ringMaterials.push(mat);
          }
        });
        if (name === 'material' || name === 'Материал') screenMesh = node;
        if (name === '.002') ringMesh = node;
        if (name === '.001' || name === 'Material') {
          mats.forEach(function (mat) {
            if (!mat) return;
            mat.map = fabricTex;
            mat.color.setHex(0x33363e);
            mat.roughness = 0.95;
            mat.metalness = 0.0;
            mat.onBeforeCompile = function (shader) {
              shader.vertexShader = 'varying float vMypultBodyY;\n' +
                shader.vertexShader.replace('#include <begin_vertex>',
                  '#include <begin_vertex>\n' +
                  'vMypultBodyY = (modelMatrix * vec4(transformed, 1.0)).y;');
              shader.fragmentShader = 'varying float vMypultBodyY;\n' +
                shader.fragmentShader.replace('#include <color_fragment>',
                  '#include <color_fragment>\n' +
                  'diffuseColor.rgb = mix(vec3(0.02, 0.021, 0.025), diffuseColor.rgb, ' +
                  'step(vMypultBodyY, 1.02));');
            };
            mat.customProgramCacheKey = function () { return 'mypult-body-upper-black'; };
            mat.needsUpdate = true;
            bodyMaterials.push(mat);
          });
          bodyBox.expandByObject(node);
          bodyNodes.push(node);
          hasBody = true;
        }
      });
      if (!hasBody) bodyBox.setFromObject(model);
      var size = new THREE.Vector3();
      bodyBox.getSize(size);
      var scale = 2.15 / Math.max(size.y, 0.001);
      model.scale.setScalar(scale);
      model.updateMatrixWorld(true);
      bodyBox.makeEmpty();
      if (bodyNodes.length) {
        bodyNodes.forEach(function (node) { bodyBox.expandByObject(node); });
      } else {
        bodyBox.setFromObject(model);
      }
      var center = new THREE.Vector3();
      bodyBox.getCenter(center);
      model.position.x -= center.x;
      model.position.y -= center.y;
      model.position.z -= center.z;
      model.updateMatrixWorld(true);
      bodyBox.makeEmpty();
      if (bodyNodes.length) bodyNodes.forEach(function (node) { bodyBox.expandByObject(node); });
      state.model = model;
      state.screenMesh = screenMesh;
      state.ringMaterials = ringMaterials;
      State.bodyMaterials = bodyMaterials;
      applyStationColor();
      if (ringMesh) {
        model.updateMatrixWorld(true);
        var bsize = new THREE.Vector3();
        var bcenter = new THREE.Vector3();
        bodyBox.getSize(bsize);
        bodyBox.getCenter(bcenter);
        var ringGeo = ringMesh.geometry;
        ringMesh.visible = true;
        var ringColors = new Float32Array(ringGeo.attributes.position.count * 3);
        ringGeo.setAttribute('color', new THREE.BufferAttribute(ringColors, 3));
        ringMesh.material = new THREE.MeshBasicMaterial({
          vertexColors: true, side: THREE.DoubleSide,
          transparent: true, toneMapped: false
        });
        state.ringMesh = ringMesh;

        var logoCanvas = document.createElement('canvas');
        logoCanvas.width = 512;
        logoCanvas.height = 512;
        var lctx = logoCanvas.getContext('2d');
        lctx.clearRect(0, 0, 512, 512);
        var glow = lctx.createRadialGradient(256, 256, 90, 256, 256, 250);
        glow.addColorStop(0, 'rgba(190,130,255,.42)');
        glow.addColorStop(0.55, 'rgba(150,90,255,.16)');
        glow.addColorStop(1, 'rgba(120,70,255,0)');
        lctx.fillStyle = glow;
        lctx.fillRect(0, 0, 512, 512);
        lctx.shadowColor = 'rgba(196,145,255,.55)';
        lctx.shadowBlur = 12;
        lctx.fillStyle = '#c084fc';
        function plectrum(ctx, scale) {
          ctx.save();
          ctx.translate(256, 256);
          ctx.scale(scale, scale);
          ctx.translate(-256, -256);
          ctx.beginPath();
          ctx.moveTo(256, 116);
          ctx.quadraticCurveTo(284, 116, 302, 160);
          ctx.lineTo(369, 332);
          ctx.quadraticCurveTo(383, 370, 345, 378);
          ctx.lineTo(167, 378);
          ctx.quadraticCurveTo(129, 370, 143, 332);
          ctx.lineTo(210, 160);
          ctx.quadraticCurveTo(228, 116, 256, 116);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        lctx.fillStyle = '#c084fc';
        lctx.beginPath();
        lctx.arc(256, 256, 136, 0, Math.PI * 2);
        lctx.fill();
        lctx.shadowBlur = 0;
        lctx.fillStyle = '#17131f';
        plectrum(lctx, 0.56);
        var logoTex = new THREE.CanvasTexture(logoCanvas);
        logoTex.minFilter = THREE.LinearFilter;
        if (THREE.sRGBEncoding) logoTex.encoding = THREE.sRGBEncoding;
        var logoPlane = new THREE.Mesh(
          new THREE.PlaneGeometry(0.9, 0.9),
          new THREE.MeshBasicMaterial({ map: logoTex, transparent: true,
            depthWrite: false, side: THREE.DoubleSide })
        );
        logoPlane.position.set(bcenter.x, bodyBox.max.y + 0.008, bcenter.z);
        logoPlane.rotation.x = -Math.PI / 2;
        logoPlane.renderOrder = 8;
        scene.add(logoPlane);
        state.logoPlane = logoPlane;
        var backZ = bodyBox.min.z - 0.012;
        function roundRectPath(ctx, x, y, w, h, r) {
          ctx.beginPath();
          ctx.moveTo(x + r, y);
          ctx.arcTo(x + w, y, x + w, y + h, r);
          ctx.arcTo(x + w, y + h, x, y + h, r);
          ctx.arcTo(x, y + h, x, y, r);
          ctx.arcTo(x, y, x + w, y, r);
          ctx.closePath();
        }
        var muteCanvas = document.createElement('canvas');
        muteCanvas.width = 512;
        muteCanvas.height = 192;
        var mctx = muteCanvas.getContext('2d');
        mctx.clearRect(0, 0, 512, 192);
        mctx.shadowColor = 'rgba(0,0,0,.7)';
        mctx.shadowBlur = 18;
        mctx.fillStyle = '#111318';
        roundRectPath(mctx, 40, 46, 432, 100, 44);
        mctx.fill();
        mctx.shadowBlur = 0;
        mctx.strokeStyle = 'rgba(255,255,255,.18)';
        mctx.lineWidth = 2;
        mctx.stroke();
        mctx.fillStyle = '#d8d9df';
        roundRectPath(mctx, 244, 62, 24, 58, 12);
        mctx.fill();
        mctx.strokeStyle = '#d8d9df';
        mctx.lineWidth = 5;
        mctx.lineCap = 'round';
        mctx.beginPath();
        mctx.arc(256, 116, 32, 0, Math.PI);
        mctx.stroke();
        mctx.beginPath();
        mctx.moveTo(256, 148);
        mctx.lineTo(256, 160);
        mctx.moveTo(238, 162);
        mctx.lineTo(274, 162);
        mctx.stroke();
        var muteTex = new THREE.CanvasTexture(muteCanvas);
        muteTex.minFilter = THREE.LinearFilter;
        if (THREE.sRGBEncoding) muteTex.encoding = THREE.sRGBEncoding;
        var mutePlane = new THREE.Mesh(
          new THREE.PlaneGeometry(0.46, 0.17),
          new THREE.MeshBasicMaterial({ map: muteTex, transparent: true,
            depthWrite: false, side: THREE.DoubleSide })
        );
        mutePlane.position.set(bcenter.x, bodyBox.max.y - 0.48, backZ);
        mutePlane.rotation.y = Math.PI;
        mutePlane.renderOrder = 6;
        scene.add(mutePlane);

        var usbCanvas = document.createElement('canvas');
        usbCanvas.width = 256;
        usbCanvas.height = 128;
        var uctx = usbCanvas.getContext('2d');
        uctx.clearRect(0, 0, 256, 128);
        uctx.fillStyle = '#0b0d11';
        roundRectPath(uctx, 56, 40, 144, 48, 22);
        uctx.fill();
        uctx.strokeStyle = 'rgba(255,255,255,.26)';
        uctx.lineWidth = 3;
        uctx.stroke();
        uctx.fillStyle = '#2b2e36';
        roundRectPath(uctx, 74, 54, 108, 20, 10);
        uctx.fill();
        var usbTex = new THREE.CanvasTexture(usbCanvas);
        usbTex.minFilter = THREE.LinearFilter;
        if (THREE.sRGBEncoding) usbTex.encoding = THREE.sRGBEncoding;
        var usbPlane = new THREE.Mesh(
          new THREE.PlaneGeometry(0.24, 0.12),
          new THREE.MeshBasicMaterial({ map: usbTex, transparent: true,
            depthWrite: false, side: THREE.DoubleSide })
        );
        usbPlane.position.set(bcenter.x, bodyBox.min.y + 0.44, backZ);
        usbPlane.rotation.y = Math.PI;
        usbPlane.renderOrder = 6;
        scene.add(usbPlane);
      }
      if (screenMesh) {
        model.updateMatrixWorld(true);
        var sbox = new THREE.Box3().setFromObject(screenMesh);
        var ssize = new THREE.Vector3();
        var scenter = new THREE.Vector3();
        sbox.getSize(ssize);
        sbox.getCenter(scenter);
        var normal = new THREE.Vector3(0, 0, 1)
          .applyQuaternion(screenMesh.getWorldQuaternion(new THREE.Quaternion())).normalize();
        screenMesh.visible = false;
        var texture = new THREE.CanvasTexture(document.getElementById('homeScreen'));
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        var plane = new THREE.Mesh(
          new THREE.PlaneGeometry(Math.max(ssize.x * 1.65, 1.0), Math.max(ssize.x * 1.65, 1.0) / 4),
          new THREE.MeshBasicMaterial({ map: texture, transparent: true,
            blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
            polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
        );
        plane.position.set(bcenter.x, scenter.y, bodyBox.max.z + 0.002);
        plane.rotation.set(0, 0, 0);
        plane.renderOrder = 5;
        scene.add(plane);
        state.screenPlane = plane;
        state.screenTexture = texture;
      }
      stage.classList.add('gl-on');
      var last = 0;
      function frame(now) {
        requestAnimationFrame(frame);
        if (document.hidden || now - last < 33) return;
        last = now;
        camera.position.set(
          Math.sin(state.yaw) * state.distance,
          0.35 + Math.sin(state.pitch) * state.distance,
          Math.cos(state.yaw) * state.distance
        );
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
      }
      requestAnimationFrame(frame);
      drawHomeScreen();
      syncHomeRing();
      everyHome(1000, drawHomeScreen);
      everyHome(130, syncHomeRing);
    }, undefined, function (error) {
      console.warn('GLTF load failed', error);
      stage.classList.remove('gl-on');
    });
    return true;
  }

  function initStationGL() {
    var canvas = document.getElementById('stationGL');
    var stage = document.getElementById('stationStage');
    if (!canvas || !stage) return false;
    var gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: true });
    if (!gl) return false;
    function compile(type, source) {
      var shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return null;
      return shader;
    }
    var vs = compile(gl.VERTEX_SHADER,
      'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }');
    var fs = compile(gl.FRAGMENT_SHADER, [
      'precision highp float;',
      'uniform vec2 u_res; uniform vec2 u_rot; uniform vec3 u_ring; uniform sampler2D u_screen; uniform sampler2D u_fabric;',
      'const vec3 B = vec3(0.48, 0.55, 0.48);',
      'vec3 fabricAt(vec2 uv){ vec3 c = texture2D(u_fabric, uv + 0.5).rgb; return c; }',
      'float sdRound(vec3 p){ vec3 q = abs(p) - B + 0.14;',
      '  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - 0.14; }',
      'vec3 calcNormal(vec3 p){ vec2 e = vec2(0.0015, 0.0);',
      '  return normalize(vec3(sdRound(p+e.xyy)-sdRound(p-e.xyy),',
      '    sdRound(p+e.yxy)-sdRound(p-e.yxy), sdRound(p+e.yyx)-sdRound(p-e.yyx))); }',
      'void main(){',
      '  vec2 uv = (gl_FragCoord.xy / u_res) * 2.0 - 1.0;',
      '  uv.x *= u_res.x / u_res.y;',
      '  vec3 ro = vec3(sin(u_rot.x) * 1.55, 0.60 + u_rot.y, cos(u_rot.x) * 1.55);',
      '  vec3 ta = vec3(0.0);',
      '  vec3 ww = normalize(ta - ro);',
      '  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));',
      '  vec3 vv = cross(uu, ww);',
      '  vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.20 * ww);',
      '  float t = 0.05; bool hit = false;',
      '  for (int i = 0; i < 96; i++) {',
      '    float d = sdRound(ro + rd * t);',
      '    if (d < 0.001) { hit = true; break; }',
      '    t += d; if (t > 7.0) break;',
      '  }',
      '  if (!hit) { gl_FragColor = vec4(0.0); return; }',
      '  vec3 p = ro + rd * t; vec3 n = calcNormal(p);',
      '  vec3 L = normalize(vec3(-0.55, 0.85, 0.65));',
      '  float diff = max(dot(n, L), 0.0);',
      '  vec3 col = vec3(0.055, 0.058, 0.066);',
      '  if (n.y > 0.55) {',
      '    col = vec3(0.018, 0.020, 0.025);',
      '    float m = max(abs(p.x), abs(p.z));',
      '    float ring = smoothstep(0.355, 0.37, m) * (1.0 - smoothstep(0.415, 0.44, m));',
      '    float glow = exp(-pow((m - 0.395) / 0.035, 2.0));',
      '    col += u_ring * (ring * 1.05 + glow * 0.14);',
      '    float cm = length(vec2(p.x / 0.065, p.z / 0.036));',
      '    col += u_ring * smoothstep(1.0, 0.75, cm) * 0.55;',
      '    float spec = pow(max(dot(reflect(-L, n), -rd), 0.0), 36.0);',
      '    col += vec3(spec * 0.35);',
      '  } else if (n.z < -0.55) {',
      '    col = fabricAt(p.xy) * vec3(0.62, 0.64, 0.68);',
      '    float mute = length(vec2(p.x / 0.115, (p.y - 0.34) / 0.038));',
      '    if (mute < 1.0) col = vec3(0.008, 0.009, 0.012);',
      '    if (mute < 0.55 && abs(p.x) < 0.008 && abs(p.y - 0.34) < 0.012) col = vec3(0.55);',
      '    float usb = length(vec2(p.x / 0.07, (p.y + 0.44) / 0.018));',
      '    if (usb < 1.0) col = vec3(0.003);',
      '  } else if (n.z > 0.55) {',
      '    col = fabricAt(p.xy) * vec3(0.65, 0.67, 0.70);',
      '    vec2 suv = vec2((p.x + 0.32) / 0.64, (p.y - 0.02) / 0.22);',
      '    if (suv.x > 0.0 && suv.x < 1.0 && suv.y > 0.0 && suv.y < 1.0) {',
      '      vec4 sc = texture2D(u_screen, suv);',
      '      col = mix(col, sc.rgb, sc.a);',
      '    }',
      '  } else {',
      '    vec2 q = abs(n.x) > 0.5 ? p.zy : p.xy;',
      '    col = fabricAt(q) * vec3(0.58, 0.60, 0.64);',
      '  }',
      '  float spec = pow(max(dot(reflect(-L, n), -rd), 0.0), 24.0);',
      '  col *= 0.52 + 0.62 * diff;',
      '  col += spec * 0.15;',
      '  float rim = pow(1.0 - max(dot(n, -rd), 0.0), 2.0);',
      '  col += u_ring * rim * 0.035;',
      '  col *= mix(0.55, 1.0, smoothstep(-0.55, 0.0, p.y));',
      '  gl_FragColor = vec4(pow(col, vec3(0.92)), 1.0);',
      '}'
    ].join('\n'));
    if (!vs || !fs) return false;
    var program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
    gl.useProgram(program);
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(program, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var fabricCanvas = document.createElement('canvas');
    fabricCanvas.width = 512;
    fabricCanvas.height = 512;
    var fctx = fabricCanvas.getContext('2d');
    fctx.fillStyle = '#34373e';
    fctx.fillRect(0, 0, 512, 512);
    for (var fy = 0; fy < 512; fy += 3) {
      fctx.fillStyle = fy % 8 === 0 ? 'rgba(255,255,255,.09)' : 'rgba(0,0,0,.20)';
      fctx.fillRect(0, fy, 512, 1);
    }
    for (var fx = 0; fx < 512; fx += 3) {
      fctx.fillStyle = fx % 8 === 0 ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.15)';
      fctx.fillRect(fx, 0, 1, 512);
    }
    fctx.strokeStyle = 'rgba(255,255,255,.035)';
    fctx.lineWidth = 1;
    for (var fd = -512; fd < 512; fd += 11) {
      fctx.beginPath();
      fctx.moveTo(fd, 0);
      fctx.lineTo(fd + 512, 512);
      fctx.stroke();
    }
    var noiseSeed = 12345;
    for (var fn = 0; fn < 24000; fn++) {
      noiseSeed = (noiseSeed * 1664525 + 1013904223) >>> 0;
      var nx = noiseSeed % 512;
      noiseSeed = (noiseSeed * 1664525 + 1013904223) >>> 0;
      var ny = noiseSeed % 512;
      fctx.fillStyle = (noiseSeed & 1)
        ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.12)';
      fctx.fillRect(nx, ny, 1, 1);
    }
    var fabric = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, fabric);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, fabricCanvas);
    var state = {
      gl: gl, program: program, texture: texture, fabric: fabric,
      uRes: gl.getUniformLocation(program, 'u_res'),
      uRot: gl.getUniformLocation(program, 'u_rot'),
      uRing: gl.getUniformLocation(program, 'u_ring'),
      uScreen: gl.getUniformLocation(program, 'u_screen'),
      uFabric: gl.getUniformLocation(program, 'u_fabric'),
      ring: [0.55, 0.36, 0.96], yaw: 0.42, pitch: 0.24
    };
    window.__stationGL = state;
    gl.clearColor(0, 0, 0, 0);
    gl.uniform1i(state.uScreen, 0);
    gl.uniform1i(state.uFabric, 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fabric);
    gl.activeTexture(gl.TEXTURE0);
    drawHomeScreen();
    stage.classList.add('gl-on');
    var drag = null;
    stage.addEventListener('pointerdown', function (event) {
      drag = { x: event.clientX, y: event.clientY, yaw: state.yaw, pitch: state.pitch };
      setPullRefresh(false);
      try { stage.setPointerCapture(event.pointerId); } catch (e) {}
    });
    stage.addEventListener('pointermove', function (event) {
      if (!drag) return;
      state.yaw = drag.yaw - (event.clientX - drag.x) * 0.005;
      state.pitch = Math.max(-0.08, Math.min(0.42, drag.pitch + (event.clientY - drag.y) * 0.003));
    });
    stage.addEventListener('pointerup', function () { drag = null; setPullRefresh(true); });
    stage.addEventListener('pointercancel', function () { drag = null; setPullRefresh(true); });
    stage.addEventListener('lostpointercapture', function () { drag = null; setPullRefresh(true); });
    stage.addEventListener('dblclick', function () { state.yaw = 0.42; state.pitch = 0.24; });
    function resize() {
      var rect = stage.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    }
    resize();
    if (window.ResizeObserver) new ResizeObserver(resize).observe(stage);
    else window.addEventListener('resize', resize);
    var last = 0;
    function frame(now) {
      requestAnimationFrame(frame);
      if (document.hidden || now - last < 33) return;
      last = now;
      if (canvas.width !== Math.round(stage.getBoundingClientRect().width * Math.min(window.devicePixelRatio || 1, 1.75))) {
        resize();
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, fabric);
      gl.uniform2f(state.uRes, canvas.width, canvas.height);
      gl.uniform2f(state.uRot, state.yaw, state.pitch);
      gl.uniform3f(state.uRing, state.ring[0], state.ring[1], state.ring[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    requestAnimationFrame(frame);
    return true;
  }

  function syncHomeRing() {
    var ring = document.getElementById('homeRing');
    var off = State.ledMode === 'off' && !State.ringPreview && !State.hwActive;
    var color = '';
    if (!off) {
      for (var i = 0; i < ringDots.length; i++) {
        var bg = ringDots[i] && ringDots[i].style.background;
        if (bg && bg !== 'transparent' && bg !== '#171b26' && bg !== '#16352a') {
          color = bg;
          break;
        }
      }
    }
    if (!color) color = '#8b5cf6';
    if (ring) {
      ring.style.borderColor = color;
      ring.style.opacity = off ? '.55' : '1';
      ring.style.boxShadow = 'inset 0 0 12px ' + color + '40,0 0 14px ' + color + '80';
    }
    var rgb = [0.55, 0.36, 0.96];
    if (color.charAt(0) === '#') {
      rgb = [parseInt(color.slice(1, 3), 16) / 255,
        parseInt(color.slice(3, 5), 16) / 255,
        parseInt(color.slice(5, 7), 16) / 255];
    } else {
      var match = color.match(/\d+/g);
      if (match && match.length >= 3) {
        rgb = [Number(match[0]) / 255, Number(match[1]) / 255, Number(match[2]) / 255];
      }
    }
    var glState = window.__stationGL;
    if (glState) {
      glState.ring = rgb;
    }
    var gltfState = window.__stationGLTF;
    if (gltfState && gltfState.ringMaterials) {
      gltfState.ringMaterials.forEach(function (material) {
        if (material.emissive) {
          material.emissive.setRGB(rgb[0], rgb[1], rgb[2]);
          material.emissiveIntensity = off ? 0.8 : 6.0;
          if ('toneMapped' in material) material.toneMapped = false;
          material.needsUpdate = true;
        }
        if (material.color) {
          material.color.setRGB(rgb[0] * 0.5, rgb[1] * 0.5, rgb[2] * 0.5);
        }
      });
    }
    if (gltfState && gltfState.ringTube) {
      gltfState.ringTube.color.setRGB(rgb[0], rgb[1], rgb[2]);
      gltfState.ringTube.opacity = off ? 0.45 : 1;
      gltfState.ringTube.transparent = true;
    }
    if (gltfState && gltfState.ringMesh) {
      var colors24 = [];
      for (var ri = 0; ri < 24; ri++) {
        var dotColor = !off && ringDots[ri] ? ringDots[ri].style.background : '';
        var cr = [0.55, 0.36, 0.96];
        if (dotColor && dotColor.charAt(0) === '#') {
          cr = [parseInt(dotColor.slice(1, 3), 16) / 255,
            parseInt(dotColor.slice(3, 5), 16) / 255,
            parseInt(dotColor.slice(5, 7), 16) / 255];
        } else if (dotColor) {
          var cm = dotColor.match(/\d+/g);
          if (cm && cm.length >= 3) cr = [cm[0] / 255, cm[1] / 255, cm[2] / 255];
        }
        if (off) cr = [0.018, 0.019, 0.022];
        colors24.push(cr);
      }
      var geom = gltfState.ringMesh.geometry;
      var pos = geom.attributes.position;
      var col = geom.attributes.color;
      for (var vi = 0; vi < pos.count; vi++) {
        var vx = pos.getX(vi);
        var vz = pos.getZ(vi);
        var at = (Math.atan2(vz, vx) / (Math.PI * 2) + 1) % 1;
        var fidx = at * 24;
        var i0 = Math.floor(fidx) % 24;
        var i1 = (i0 + 1) % 24;
        var frac = fidx - Math.floor(fidx);
        var c0 = colors24[i0];
        var c1 = colors24[i1];
        col.setXYZ(vi,
          c0[0] + (c1[0] - c0[0]) * frac,
          c0[1] + (c1[1] - c0[1]) * frac,
          c0[2] + (c1[2] - c0[2]) * frac);
      }
      col.needsUpdate = true;
      gltfState.ringMesh.visible = true;
      gltfState.ringMesh.material.opacity = 1;
    }
    if (gltfState && gltfState.ringBand) {
      gltfState.ringBand.color.setRGB(rgb[0], rgb[1], rgb[2]);
      gltfState.ringBand.opacity = off ? 0.5 : 1;
      gltfState.ringBand.transparent = true;
    }
    if (gltfState && gltfState.ringGlow) {
      gltfState.ringGlow.color.setRGB(rgb[0], rgb[1], rgb[2]);
      gltfState.ringGlow.opacity = off ? 0.12 : 0.28;
    }
    if (gltfState && gltfState.ringDots3d) {
      gltfState.ringDots3d.forEach(function (material, index) {
        var dot = ringDots[index] && ringDots[index].style.background;
        var c = [0.55, 0.36, 0.96];
        if (dot && dot.charAt(0) === '#') {
          c = [parseInt(dot.slice(1, 3), 16) / 255,
            parseInt(dot.slice(3, 5), 16) / 255,
            parseInt(dot.slice(5, 7), 16) / 255];
        } else if (dot) {
          var m = dot.match(/\d+/g);
          if (m && m.length >= 3) c = [m[0] / 255, m[1] / 255, m[2] / 255];
        }
        material.color.setRGB(c[0], c[1], c[2]);
      });
    }
  }

  function initStation3D() {
    var stage = document.getElementById('stationStage');
    if (!stage) return;
    if (initStationGLTF()) return;
    if (initStationGL()) {
      drawHomeScreen();
      syncHomeRing();
      everyHome(1000, drawHomeScreen);
      everyHome(130, syncHomeRing);
      return;
    }
    var fallback = document.getElementById('stationFallback');
    if (fallback) fallback.hidden = false;
  }

  function syncHomePlayer() {
    var title = document.getElementById('homeTitle');
    if (!title) return;
    title.textContent = State.mediaTitle || 'Ничего не играет';
    document.getElementById('homeArtist').textContent =
      State.mediaArtist || 'Яндекс Музыка и радио';
    var cover = document.getElementById('homeCover');
    var art = document.getElementById('homeArt');
    if (State.mediaCover) {
      cover.src = State.mediaCover;
      cover.hidden = false;
      if (art) art.style.display = 'none';
    } else {
      cover.hidden = true;
      cover.removeAttribute('src');
      if (art) art.style.display = '';
    }
    var play = document.getElementById('homePlay');
    if (play) {
      play.querySelector('use').setAttribute('href', State.playing ? '#i-pause' : '#i-play');
    }
    var volume = document.getElementById('homeVolume');
    if (volume && !State.homeVolumeDragging) {
      volume.value = String(State.volume || 0);
      document.getElementById('homeVolumeVal').textContent = (State.volume || 0) + '%';
    }
  }

  var HOME_EXTRAS = {
    resources: 'Ресурсы',
    alarm: 'Будильник',
    network: 'Сеть',
    scenarios: 'Сценарии',
    ai: 'Нейросеть'
  };

  function syncHomeStats(data) {
    State.homeSystem = data || null;
    if (State.homeExtra === 'resources') renderHomeExtra();
  }

  function syncHomeAlarm() {
    if (State.homeExtra === 'alarm') renderHomeExtra();
  }

  function homeCell(label, value) {
    var cell = document.createElement('div');
    cell.className = 'home-extra-cell';
    var l = document.createElement('span');
    l.textContent = label;
    var v = document.createElement('b');
    v.textContent = value == null || value === '' ? '—' : String(value);
    cell.appendChild(l);
    cell.appendChild(v);
    return cell;
  }

  function homeLine(label, value) {
    var row = document.createElement('div');
    row.className = 'home-extra-line';
    var l = document.createElement('span');
    l.textContent = label;
    var v = document.createElement('b');
    v.textContent = value == null || value === '' ? '—' : String(value);
    row.appendChild(l);
    row.appendChild(v);
    return row;
  }

  function renderHomeExtra() {
    var body = document.getElementById('homeExtraBody');
    if (!body) return;
    var label = document.getElementById('homeExtraLabel');
    if (label) label.textContent = HOME_EXTRAS[State.homeExtra] || 'Ресурсы';
    body.innerHTML = '';
    if (State.homeExtra === 'resources') {
      var data = State.homeSystem || {};
      var cpu = data.cpu || {};
      var temp = data.temperature || {};
      var mem = data.memory || {};
      var disks = data.disk || [];
      var dataDisk = null;
      disks.forEach(function (disk) { if (disk.mount === '/data') dataDisk = disk; });
      var grid = document.createElement('div');
      grid.className = 'home-extra-grid';
      grid.appendChild(homeCell('CPU', cpu.percent == null ? '—' : cpu.percent + '%'));
      grid.appendChild(homeCell('Температура', temp.hottest ? temp.hottest.c + '°C' : '—'));
      grid.appendChild(homeCell('Память', mem.percent == null ? '—' : mem.percent + '%'));
      grid.appendChild(homeCell('Диск /data', dataDisk ? dataDisk.percent + '%' : '—'));
      body.appendChild(grid);
      return;
    }
    if (State.homeExtra === 'alarm') {
      var items = (State.alarms || []).filter(function (alarm) { return alarm.enabled; })
        .sort(function (a, b) { return String(a.time).localeCompare(String(b.time)); });
      if (!items.length) {
        body.innerHTML = '<div class="home-extra-empty">Будильников нет</div>';
        return;
      }
      body.appendChild(homeLine('Ближайший', items[0].time));
      body.appendChild(homeLine('Повтор', items[0].once ? 'один раз' : alarmDaysText(items[0].days)));
      body.appendChild(homeLine('Режим', items[0].label || items[0].text || items[0].mode || '—'));
      return;
    }
    if (State.homeExtra === 'network') {
      var net = State.homeNet || {};
      var vpn = State.homeVpn || {};
      body.appendChild(homeLine('Wi-Fi', net.connected ? (net.ssid || 'подключено') : (net.state || 'нет')));
      body.appendChild(homeLine('IP', net.ip || '—'));
      body.appendChild(homeLine('Сигнал', net.signal == null ? '—' : net.signal + ' dBm'));
      body.appendChild(homeLine('VPN', vpn.running ? 'включён' : (vpn.url_set ? 'выключен' : 'не настроен')));
      return;
    }
    if (State.homeExtra === 'scenarios') {
      var scenarios = State.homeScenarios || [];
      if (!scenarios.length) {
        body.innerHTML = '<div class="home-extra-empty">Своих сценариев нет</div>';
        return;
      }
      body.appendChild(homeLine('Всего', scenarios.length));
      scenarios.slice(0, 3).forEach(function (scenario) {
        body.appendChild(homeLine(scenario.name || 'Сценарий', scenario.phrases || ''));
      });
      return;
    }
    var llm = State.homeLlm || {};
    body.appendChild(homeLine('Провайдер', llm.provider || llm.current || '—'));
    body.appendChild(homeLine('Модель', llm.model || llm.current_model || '—'));
    if (llm.enabled != null) body.appendChild(homeLine('Состояние', llm.enabled ? 'включена' : 'выключена'));
  }

  function loadHomeExtraData(kind) {
    if (kind === 'network') {
      return Promise.all([
        cgi('network.py', {}, { timeout: 15000, silent: true }).catch(function () { return null; }),
        cgi('vpn.py', { info: 1 }, { timeout: 10000, silent: true }).catch(function () { return null; })
      ]).then(function (result) {
        State.homeNet = result[0] || {};
        State.homeVpn = result[1] || {};
        if (State.homeExtra === 'network') renderHomeExtra();
      });
    }
    if (kind === 'scenarios') {
      return cgi('scenarios.py', {}, { timeout: 10000, silent: true }).then(function (data) {
        State.homeScenarios = data.scenarios || [];
        if (State.homeExtra === 'scenarios') renderHomeExtra();
      }).catch(function () {});
    }
    if (kind === 'ai') {
      return cgi('llm.py', { info: 1 }, { timeout: 10000, silent: true }).then(function (data) {
        State.homeLlm = data || {};
        if (State.homeExtra === 'ai') renderHomeExtra();
      }).catch(function () {});
    }
    return Promise.resolve();
  }

  function setHomeExtra(kind) {
    if (!HOME_EXTRAS[kind]) kind = 'resources';
    State.homeExtra = kind;
    store.set('homeExtra', kind);
    renderHomeExtra();
    renderHomeExtraOptions();
    loadHomeExtraData(kind);
  }

  function renderHomeExtraOptions() {
    var pop = document.getElementById('homeExtraPop');
    if (!pop) return;
    pop.innerHTML = '';
    Object.keys(HOME_EXTRAS).forEach(function (kind) {
      var item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', State.homeExtra === kind ? 'true' : 'false');
      item.textContent = HOME_EXTRAS[kind];
      item.addEventListener('click', function () {
        setHomeExtra(kind);
        pop.hidden = true;
        var button = document.getElementById('btnHomeExtra');
        if (button) button.setAttribute('aria-expanded', 'false');
      });
      pop.appendChild(item);
    });
  }

  function placeHomeExtraPop() {
    var button = document.getElementById('btnHomeExtra');
    var pop = document.getElementById('homeExtraPop');
    if (!button || !pop || pop.hidden) return;
    var rect = button.getBoundingClientRect();
    var width = Math.max(180, Math.min(260, rect.width));
    var left = Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8));
    var below = window.innerHeight - rect.bottom - 10;
    var above = rect.top - 10;
    var up = below < 160 && above > below;
    var height = Math.max(120, Math.min(300, up ? above : below));
    pop.style.position = 'fixed';
    pop.style.width = width + 'px';
    pop.style.left = left + 'px';
    pop.style.maxHeight = height + 'px';
    pop.style.overflow = 'auto';
    if (up) {
      pop.style.top = 'auto';
      pop.style.bottom = (window.innerHeight - rect.top + 6) + 'px';
    } else {
      pop.style.top = (rect.bottom + 6) + 'px';
      pop.style.bottom = 'auto';
    }
  }

  function initHomeExtra() {
    var button = document.getElementById('btnHomeExtra');
    var pop = document.getElementById('homeExtraPop');
    if (!button || !pop) return;
    // Попап вне карточки: иначе её transform делает fixed относительным
    // карточки, и список обрезается/съезжает.
    document.body.appendChild(pop);
    var saved = store.get('homeExtra', 'resources');
    State.homeExtra = HOME_EXTRAS[saved] ? saved : 'resources';
    renderHomeExtraOptions();
    renderHomeExtra();
    loadHomeExtraData(State.homeExtra);
    button.addEventListener('click', function (event) {
      event.stopPropagation();
      pop.hidden = !pop.hidden;
      if (!pop.hidden) placeHomeExtraPop();
      button.setAttribute('aria-expanded', pop.hidden ? 'false' : 'true');
    });
    window.addEventListener('resize', function () {
      if (!pop.hidden) placeHomeExtraPop();
    });
    document.addEventListener('scroll', function () {
      if (!pop.hidden) placeHomeExtraPop();
    }, true);
    pop.addEventListener('click', function (event) { event.stopPropagation(); });
    document.addEventListener('click', function (event) {
      if (!event.target.closest('#btnHomeExtra') && !event.target.closest('#homeExtraPop')) {
        pop.hidden = true;
        button.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        pop.hidden = true;
        button.setAttribute('aria-expanded', 'false');
      }
    });
  }

  function buildMobileTabs() {
    var menu = document.getElementById('mobileTabsMenu');
    var button = document.getElementById('btnMobileTabs');
    var label = document.getElementById('mobileTabLabel');
    if (!menu || !button || !el.tabs) return;
    menu.innerHTML = '';
    Array.prototype.forEach.call(el.tabs.children, function (tab) {
      var item = document.createElement('button');
      item.type = 'button';
      item.dataset.tab = tab.dataset.tab;
      item.textContent = tab.textContent;
      item.addEventListener('click', function () {
        showTab(tab.dataset.tab);
        menu.hidden = true;
        button.setAttribute('aria-expanded', 'false');
      });
      menu.appendChild(item);
    });
    function placeMenu() {
      if (menu.hidden) return;
      var rect = button.getBoundingClientRect();
      var width = Math.min(Math.max(rect.width, 240), window.innerWidth - 24);
      var left = Math.min(Math.max(12, rect.left), window.innerWidth - width - 12);
      var top = rect.bottom + 8;
      menu.style.left = Math.round(left) + 'px';
      menu.style.top = Math.round(top) + 'px';
      menu.style.width = Math.round(width) + 'px';
      menu.style.maxHeight = Math.max(120, window.innerHeight - top - 12) + 'px';
    }

    button.addEventListener('click', function (event) {
      event.stopPropagation();
      menu.hidden = !menu.hidden;
      button.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
      if (!menu.hidden) placeMenu();
    });
    window.addEventListener('resize', placeMenu);
    window.addEventListener('scroll', function () {
      if (menu.hidden) return;
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    }, true);
    menu.addEventListener('click', function (event) { event.stopPropagation(); });
    document.addEventListener('click', function (event) {
      if (!event.target.closest('#btnMobileTabs') && !event.target.closest('#mobileTabsMenu')) {
        menu.hidden = true;
        button.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !menu.hidden) {
        menu.hidden = true;
        button.setAttribute('aria-expanded', 'false');
      }
    });
    var active = el.tabs.querySelector('.tab[aria-pressed="true"]');
    if (active && label) label.textContent = active.textContent.replace(/^[^\wА-Яа-я]+/, '');
  }

  var STATION_COLORS = {
    black: { label: 'Чёрный', tint: 0x33363e },
    gray: { label: 'Серый', tint: 0xc4c7cf },
    emerald: { label: 'Изумрудный', tint: 0x1c9c76 },
    raspberry: { label: 'Малиновый', tint: 0xa52565 },
    yellow: { label: 'Жёлтый', tint: 0xc99b19 }
  };

  function applyStationColor() {
    var spec = STATION_COLORS[State.stationColor] || STATION_COLORS.black;
    if (State.bodyMaterials) {
      State.bodyMaterials.forEach(function (material) {
        if (material && material.color) {
          material.color.setHex(spec.tint);
          material.needsUpdate = true;
        }
      });
    }
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-station-color]'), function (button) {
        button.setAttribute('aria-pressed',
          button.dataset.stationColor === State.stationColor ? 'true' : 'false');
      });
  }

  function initStationColors() {
    var saved = store.get('stationColor', 'black');
    State.stationColor = STATION_COLORS[saved] ? saved : 'black';
    Array.prototype.forEach.call(
      document.querySelectorAll('[data-station-color]'), function (button) {
        button.addEventListener('click', function () {
          State.stationColor = button.dataset.stationColor;
          store.set('stationColor', State.stationColor);
          applyStationColor();
        });
      });
    applyStationColor();
  }

  function initHome() {
    initStation3D();
    initStationColors();
    syncHomePlayer();
    syncHomeAlarm();
    initHomeExtra();
    var play = document.getElementById('homePlay');
    if (play) play.addEventListener('click', function () {
      mediaAction(State.playing ? 'pause' : 'play');
    });
    var prev = document.getElementById('homePrev');
    if (prev) prev.addEventListener('click', function () { mediaAction('prev'); });
    var next = document.getElementById('homeNext');
    if (next) next.addEventListener('click', function () { mediaAction('next'); });
    var volume = document.getElementById('homeVolume');
    if (volume) {
      volume.addEventListener('input', function () {
        State.homeVolumeDragging = true;
        document.getElementById('homeVolumeVal').textContent = volume.value + '%';
      });
      volume.addEventListener('change', function () {
        State.homeVolumeDragging = false;
        var value = parseInt(volume.value, 10) || 0;
        cgi('volume.py', { level: value }, { timeout: 10000 }).then(function () {
          setVolumeUI(value);
        }).catch(function (err) { toast('Громкость: ' + err.message, 'bad'); });
      });
    }
    ['homeVolDown', 'homeVolUp'].forEach(function (id) {
      var button = document.getElementById(id);
      if (!button) return;
      button.addEventListener('click', function () {
        var current = parseInt(volume && volume.value, 10) || State.volume || 40;
        var next = Math.max(0, Math.min(100, current + (id === 'homeVolUp' ? 5 : -5)));
        if (volume) volume.value = String(next);
        cgi('volume.py', { level: next }, { timeout: 10000 }).then(function () {
          setVolumeUI(next);
        }).catch(function () {});
      });
    });
  }

  function initLayoutPresets() {
    var select = document.getElementById('layoutPreset');
    var nameInput = document.getElementById('layoutName');
    var status = document.getElementById('layoutStatus');
    var applyBtn = document.getElementById('btnLayoutApply');
    var saveBtn = document.getElementById('btnLayoutSave');
    var deleteBtn = document.getElementById('btnLayoutDelete');
    if (!select || !status || !window.PultLayout) return;

    var presets = [];
    var mode = function () { return window.PultLayout.mode(); };
    var modeLabel = function () {
      var value = mode();
      return value === 'phone' ? 'телефона'
        : value === 'touch' ? 'планшета' : 'компьютера';
    };

    function current() {
      var id = select.value;
      for (var i = 0; i < presets.length; i++) {
        if (presets[i].id === id) return presets[i];
      }
      return null;
    }

    function render() {
      var list = presets.filter(function (item) { return item.mode === mode(); });
      var previous = select.value;
      select.innerHTML = '';
      if (!list.length) {
        var empty = document.createElement('option');
        empty.value = '';
        empty.textContent = 'Нет пресетов для ' + modeLabel();
        select.appendChild(empty);
      } else {
        list.forEach(function (item) {
          var option = document.createElement('option');
          option.value = item.id;
          option.textContent = item.name;
          select.appendChild(option);
        });
        if (previous && list.some(function (item) { return item.id === previous; })) {
          select.value = previous;
        }
      }
      var count = list.length;
      status.textContent = count
        ? 'Пресетов для ' + modeLabel() + ': ' + count
        : 'Пресетов для ' + modeLabel() + ' пока нет';
    }

    function applyDefaultIfFresh() {
      try { if (localStorage.getItem('mypult-cards')) return; } catch (e) { return; }
      var defaultName = '\u041f\u043e \u0443\u043c\u043e\u043b\u0447\u0430\u043d\u0438\u044e';
      var preset = presets.filter(function (item) {
        return item.mode === mode() && item.name === defaultName;
      })[0];
      if (!preset) {
        preset = presets.filter(function (item) {
          return item.mode === 'wide' && item.name === defaultName;
        })[0];
      }
      if (!preset) return;
      window.PultLayout.apply(preset.layout);
      status.textContent = '\u041f\u0440\u0438\u043c\u0435\u043d\u0435\u043d\u0430 \u0440\u0430\u0441\u043a\u043b\u0430\u0434\u043a\u0430 \u00ab\u041f\u043e \u0443\u043c\u043e\u043b\u0447\u0430\u043d\u0438\u044e\u00bb';
    }

    function load() {
      cgi('layout_presets.py', { action: 'list' }, { silent: true })
        .then(function (data) {
          presets = (data && data.presets) || [];
          render();
          applyDefaultIfFresh();
        })
        .catch(function (err) {
          status.textContent = 'Не удалось загрузить пресеты: ' + err.message;
        });
    }

    function savePreset(name, id, update) {
      saveBtn.disabled = true;
      var payload = {
        action: 'save',
        name: name,
        mode: mode(),
        layout: window.PultLayout.capture()
      };
      if (id) payload.id = id;
      if (update) payload.update = 1;
      cgi('layout_presets.py', payload).then(function (data) {
        presets = (data && data.presets) || [];
        nameInput.value = '';
        render();
        status.textContent = 'Сохранён пресет «' + name + '» для ' + modeLabel();
      }).catch(function (err) {
        status.textContent = 'Ошибка сохранения: ' + err.message;
      }).then(function () { saveBtn.disabled = false; });
    }

    saveBtn.addEventListener('click', function () {
      var name = (nameInput.value || '').trim();
      if (!name) {
        status.textContent = 'Введите название пресета';
        nameInput.focus();
        return;
      }
      var existing = presets.filter(function (item) {
        return item.mode === mode() &&
          String(item.name || '').toLowerCase() === name.toLowerCase();
      })[0];
      if (existing) {
        askConfirm('Пресет «' + existing.name + '» уже есть. Обновить его?',
          { yes: 'Обновить' }).then(function (ok) {
          if (ok) savePreset(name, existing.id, true);
        });
        return;
      }
      savePreset(name);
    });

    applyBtn.addEventListener('click', function () {
      var preset = current();
      if (!preset) {
        status.textContent = 'Нет пресета для применения';
        return;
      }
      window.PultLayout.apply(preset.layout);
      status.textContent = 'Применён пресет «' + preset.name + '»';
    });

    deleteBtn.addEventListener('click', function () {
      var preset = current();
      if (!preset) return;
      askConfirm('Удалить пресет «' + preset.name + '»?', { yes: 'Удалить' }).then(function (ok) {
        if (!ok) return;
        cgi('layout_presets.py', { action: 'delete', id: preset.id }).then(function (data) {
          presets = (data && data.presets) || [];
          render();
          status.textContent = 'Пресет «' + preset.name + '» удалён';
        }).catch(function (err) {
          status.textContent = 'Ошибка удаления: ' + err.message;
        });
      });
    });

    var resizeTimer = 0;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(render, 200);
    });

    load();
  }

  function init() {
    function syncScrollbarPad() {
      var sb = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
      document.documentElement.style.setProperty('--sbw', sb + 'px');
    }
    syncScrollbarPad();
    window.addEventListener('resize', syncScrollbarPad);
    if (window.ResizeObserver) {
      new ResizeObserver(syncScrollbarPad).observe(document.body);
    }
    try {
      if (localStorage.getItem('mypult-theme') === 'light') {
        document.body.classList.add('light');
        document.documentElement.classList.add('light-scroll');
        el.btnTheme.textContent = '☾';
        el.btnTheme.setAttribute('aria-label', 'Тёмная тема');
      }
    } catch (e) { /* приватный режим */ }
    [
      'pill', 'pillText', 'netLine', 'offlineBanner', 'footStatus', 'tabs',
      'clockTime', 'clockSub', 'btnDisplayReset', 'btnScreenOff', 'brightness', 'brightnessVal',
      'displayPreview', 'brightChips',
      'seg7', 'seg7Digits', 'btnDraw', 'segToolbar', 'btnSegSend', 'btnSegClear', 'btnSegDone', 'segNote',
      'displayText', 'btnDisplayText', 'btnClockBack',
      'ring', 'ringDots', 'ringHex', 'colorPicker', 'colorCode', 'presets', 'btnLedOff', 'btnRingReset', 'ledHint',
      'ringBrightness', 'ringBrightVal', 'ringSpeed', 'ringSpeedVal',
      'ringAnimStatus', 'ringAnimChips', 'btnRingAnimPlay', 'btnRingAnimStop',
      'btnRingPick', 'ringPickName', 'ringPickPop', 'ringSearch', 'ringAnimList',
      'btnRingEditor', 'ringEditorDlg', 'ringEditorRing', 'ringEditorColor',
      'btnRingEditorAdd', 'btnRingEditorDup', 'btnRingEditorDelFrame',
      'btnRingEditorFill', 'btnRingEditorClear', 'btnRingRestoreHidden',
      'ringEditorFrames', 'ringEditorName', 'ringEditorDuration',
      'btnRingEditorSave', 'btnRingEditorPlay', 'btnRingEditorDelete',
      'btnRingEditorClose', 'ringEditorSaved',
      'mediaTitle', 'mediaSub', 'btnPrev', 'btnPlay', 'btnNext', 'mediaCover', 'mediaArtIcon',
      'btnMusic', 'mediaKind', 'mediaSeek', 'mediaPos', 'mediaDur', 'mediaProgress',
      'btnLyrics', 'lyricsStatus', 'lyricsBox',
      'btnLike', 'btnDislike', 'lyricsDlg', 'lyrBg',
      'btnLyricsClose', 'lyrStage', 'npGlow',
      'btnQueue', 'queueDlg', 'queueName', 'queueList', 'btnQueueClose', 'queueKicker',
      'lyricsNow', 'lyricsInline', 'lyricsNowText',
      'alarmList', 'alarmRinging', 'alarmRingLabel', 'btnAlarmDismiss',
      'alarmTz',
      'btnAlarmSnooze', 'alarmText', 'alarmDays',
      'alarmTimeField', 'btnAlarmTime', 'alarmTimeValue', 'alarmTimePop',
      'alarmHours', 'alarmMinutes', 'btnAlarmTimeDone',
      'alarmRadioBox', 'alarmModes', 'btnAlarmStation', 'alarmStationName',
      'alarmSoundBox', 'btnAlarmSound', 'alarmSoundName', 'alarmSoundList',
      'alarmRepeatModes', 'alarmRepeatHint',
      'alarmStationList', 'alarmCustomStation', 'alarmMusicBox', 'alarmMusicText',
      'alarmVolume', 'alarmVolumeVal', 'alarmRamp', 'alarmStop', 'alarmSnooze',
      'btnAlarmAdd', 'clockAnimStatus', 'btnAlarmOpen', 'btnAlarmClose', 'alarmDlg',
      'animEditor', 'animName', 'animFrames', 'animDuration', 'animText',
      'clockAnimList', 'btnAnimRestorePresets',
      'btnAnimEditor', 'btnAnimPlay', 'btnAnimStop', 'btnAnimSave', 'btnAnimClose',
      'btnClockAnimStop',
      'btnAnimAdd', 'btnAnimDup', 'btnAnimDel', 'btnAnimText',
      'volume', 'volumeVal', 'btnVolDown', 'btnVolUp', 'btnMute',
        'command', 'btnSendCmd', 'ttsText', 'ttsCount', 'btnTtsClear', 'btnSay', 'ttsChips',
      'toasts', 'debugDlg', 'btnDebug', 'btnTheme', 'btnFaq', 'faqDlg', 'btnCloseFaq', 'btnCloseDebug', 'svcState', 'logBox', 'btnRefreshStatus',
      'btnDiag', 'diagBox',
      'verTag', 'verLine', 'capsBanner',
      'llmProviderSelect', 'llmModel', 'llmModelCustomWrap', 'llmModelCustom', 'llmBase', 'llmKey',
      'llmProfiles', 'btnLlmNew', 'llmName', 'llmActive',
      'llmChat', 'btnChatPrev', 'btnChatNext', 'btnChatNew', 'btnChatRename', 'btnChatDel',
      'llmHistoryBox', 'llmHistoryCount', 'llmHistory', 'btnChatHistoryRefresh',
      'chatRenameDlg', 'chatRenameInput', 'btnChatRenameNo', 'btnChatRenameYes', 'llmLength',
      'llmEnabled', 'llmStatus', 'btnLlmSave', 'llmPrompt', 'btnLlmAsk', 'btnLlmAskSay',
      'llmSystem', 'btnLlmSystem', 'llmSystemStatus',
      'llmSearch', 'llmSearchStatus', 'llmSearchUrl', 'btnLlmSearchUrl', 'llmSources',
      'llmFollowUp',
      'llmLocation', 'llmTimezone', 'llmTimezoneList', 'llmContextStatus', 'btnLlmContext',
      'llmAnswer', 'llmMeta',
      'vpnUrl', 'btnVpnSave', 'btnVpnToggle', 'vpnStatus', 'vpnServer', 'vpnLog', 'vpnAutostart',
      'btnVoiceDaemon', 'voiceDaemonStatus', 'voiceIdleMode', 'voiceIdleNote',
    'voiceMicMode', 'voiceMicNote', 'voicePanel',
      'voiceMusicVoice', 'voiceMusicVoiceNote', 'voiceMusicDefault', 'voiceMusicDefaultNote', 'voiceMusicSeed', 'voiceMusicSeedNote',
      'btnTermOpen', 'termStatus', 'termDlg', 'termDlgStatus', 'btnTermFinish',
      'btnTermClose', 'termHost', 'menuPosition',
      'cardPanel', 'panelBright', 'panelBrightVal', 'btnPanelOff', 'btnPanelRestore', 'panelStatus',
      'radioChips', 'btnRadioPrev', 'btnRadioStop', 'btnRadioNext', 'radioStatus',
      'radioName', 'btnRadioAdd', 'radioUrl', 'btnRadioStream',
      'btnRadioPick', 'radioPickName', 'radioPickCount', 'radioPop', 'radioSearch',
      'btnBtPairMode', 'btnBtScan', 'btStatus', 'btDevices', 'btnBtPower',
      'netPsk', 'btnNetScan', 'netStatus', 'netList', 'netDetails',
      'netDns', 'btnNetDns', 'btnNetDnsReset', 'netIpv6', 'ipv6Status',
      'zbStatus', 'zbCommand', 'btnZbSend',
      'scBuiltin', 'scList', 'scName', 'scPhrases', 'scActions', 'scType',
      'scTime', 'scDays', 'scCondVpn', 'scCondMusic',
      'btnDaysWork', 'btnDaysAll', 'btnDaysWeekend',
      'btnScAddAction', 'btnScSave', 'btnScClear',
      'logName', 'btnLogs', 'logsBox',
      'filesDlg', 'btnFilesOpen', 'btnFilesClose', 'btnFilesUp', 'btnFilesRefresh',
      'filesPath', 'btnFilesGo', 'btnFilesMkdir', 'filesUpload', 'filesRoots',
      'filesNote', 'filesList', 'filesEditor', 'filesEditorName', 'filesText',
      'btnFilesSave', 'btnFilesEditorClose', 'btnFilesRename',
      'zvukToken', 'btnZvukSave', 'btnZvukClear', 'zvukStatus', 'zvukQuery',
      'btnZvukSearch', 'btnZvukWave', 'btnZvukWaveStop', 'zvukMood', 'zvukResults', 'zvukNow', 'btnZvukSite', 'btnZvukProfile',
      'btnExtWave', 'btnExtWaveStop', 'extMood', 'extWaveService',
      'spotifyId', 'spotifySecret', 'btnSpotifySave', 'btnSpotifyClear', 'spotifyStatus',
      'spotifyQuery', 'btnSpotifySearch', 'spotifyResults',
      'extQuery', 'btnExtSearch', 'extStatus', 'extNow', 'extResults',
      'btnNetcheck', 'btnCleanup', 'btnReboot', 'btnPoweroff', 'maintBox', 'autoBright', 'autoBrightStatus',
      'displayAuto', 'displayAutoStatus', 'btnDisplayCurve', 'curveDlg', 'curveCanvas', 'curveRows',
      'btnCurveClose', 'btnCurveAdd', 'btnCurveReset', 'btnCurveSave',
      'btnSpeed', 'btnBackup', 'backupFile',
      'rebootDlg', 'btnCloseReboot', 'rebootStatus', 'rebootBar', 'rebootTime',
      'confirmDlg', 'confirmText', 'btnConfirmNo', 'btnConfirmYes',
      'updCurrent', 'updChecked', 'updNew', 'updNewTitle', 'updNotes', 'updHint',
      'updState', 'btnUpdateCheck', 'btnUpdateApply', 'updChannel', 'btnUpdateRollback',
    'updLocalPath', 'btnUpdLocal', 'updLocalHint',
      'updateDlg', 'updateDlgVer', 'updateDlgFrom', 'updateDlgNotes', 'updateDismiss',
      'btnUpdateLater', 'btnUpdateDlgNo', 'btnUpdateDlgYes',
      'btnSoundBackup', 'btnSoundRefresh', 'soundFile', 'soundList', 'soundDrop', 'soundGroup', 'soundSearch', 'soundStatus',
      'customSoundName', 'btnCustomSound', 'customSoundFile', 'customSoundList',
      'pinGate', 'pinInput', 'pinError', 'btnPinLogin',
      'pinNew', 'btnPinEnable', 'btnPinDisable', 'btnPinLock', 'pinStatus', 'pinInsecure',
      'sysCpu', 'sysCpuBar', 'sysLoad', 'sysRam', 'sysRamBar', 'sysRamSub', 'sysTemp', 'sysTempSub',
      'sysDisk', 'sysDiskBar', 'sysDiskSub', 'sysRoot', 'sysRootBar', 'sysRootSub', 'hwList', 'sysLight', 'sysLightSub', 'sysUptime', 'sysBoard'
    ].forEach(function (id) { el[id] = document.getElementById(id); });

    buildRing();
    buildSevenSeg();
    restore();
    bind();
    buildMobileTabs();
    measureTabs();
    menuPositionInit();
    termInit();
    initHome();
    initRingMusic();
    initLogo();
    initRingStatePolling();
    initYandexMusic();
    initYmDialog();
    initLyricsPlayer();
    updateVolumeIcons();
    paintRanges();
    every(1000, paintRanges);
    every(30000, refreshAutoBrightness);
    setTimeout(refreshAutoBrightness, 1500);
    document.addEventListener('input', function (event) {
      if (event.target && event.target.type === 'range') paintRange(event.target);
    }, true);
    document.addEventListener('change', function (event) {
      if (event.target && event.target.type === 'range') paintRange(event.target);
    }, true);
    renderAlarmDays();
    loadAlarms(true);
    clockAnimBind();
    renderClockAnimList();
    setInterval(function () {
      if ((State.tab === 'sound' || State.tab === 'home') && !document.hidden) loadAlarms(true);
    }, 5000);
    tickClock();
    setInterval(tickClock, 1000);
    every(130, tickRingAnims);
    setInterval(function () {
      if (State.tab === 'home' && !document.hidden) refreshSystem();
    }, 15000);
    // Клик мимо поля ввода снимает фокус: на Android WebView каретка иногда
    // продолжает мигать после закрытия клавиатуры, и это раздражает.
    document.addEventListener('pointerdown', function (event) {
      var active = document.activeElement;
      if (!active) return;
      var tag = active.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return;
      var target = event.target;
      if (!target || target === active) return;
      if (target.closest && target.closest('input,textarea,select,label')) return;
      try { active.blur(); } catch (e) { /* ignore */ }
    }, true);

    renderStatus();
    loadVersion();
    loadCaps();
    loadPanel();
    loadYmProfile();
    loadUpdateInfo(false, false);
    setInterval(function () {
      if (!document.hidden) loadUpdateInfo(false, false);
    }, 6 * 60 * 60 * 1000);
    fillScTypes();
    addScRow('speak');
    enhanceSelects();
    loadAuth();
    initCardDrag();
    initLayoutPresets();
    schedulePack();
    loadRingSpeed();
    syncVolumeFromDevice();
    refreshState();
    scheduleStateRefresh();
    setInterval(function () {
      if (!document.hidden && State.tab === 'system') refreshSystem();
    }, 10000);
    var startTab = (location.hash || '').replace('#', '') ||
      store.get(TAB_KEY, 'home');
    if (!(location.hash || '') && !store.get(START_KEY)) {
      // Новый стартовый экран — «Главная».
      store.set(START_KEY, 1);
      startTab = 'home';
    }
    try { showTab(startTab, false); } finally { document.body.classList.remove('booting'); }
    syncScrollbarPad();
    setTimeout(syncScrollbarPad, 60);
    setTimeout(syncScrollbarPad, 400);
    if (window.scrollTo) window.scrollTo({ top: 0, behavior: 'auto' });
    resumeRebootWatch();
    log('app', 'Пульт запущен', navigator.userAgent);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
