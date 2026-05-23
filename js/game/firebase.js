// ===================================================================
// firebase.js — Firebase 초기화 + Google 세션 복원
// 의존: utils.js (없음, 외부 firebase SDK는 HTML에서 미리 load)
// 노출: window._fbDb, _fbAuth, _authReady, fbInit
// 사용: 네트워크 기능, ELO 저장, 업적 등에서 _fbDb/_fbAuth 사용
// ===================================================================

const FB_CONFIG = {
  apiKey: "AIzaSyD_bv9vLqcMDMZgGHNLS2A94INXqkO8XX8",
  authDomain: "ooooomok-285e6.firebaseapp.com",
  databaseURL: "https://ooooomok-285e6-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "ooooomok-285e6",
  storageBucket: "ooooomok-285e6.firebasestorage.app",
  messagingSenderId: "764275385569",
  appId: "1:764275385569:web:44cecc18de9aef4d9a43a0"
};

// var로 선언 — 다른 script 파일에서 호이스팅으로 접근 가능
var _fbDb = null;
var _fbAuth = null;
var _authReady = null;

window.fbInit = function fbInit(){
  if(_fbDb) return;
  if(typeof firebase === 'undefined'){
    console.error('[firebase.js] Firebase SDK 미로드 — HTML에서 firebase-app-compat 등 먼저 load');
    return;
  }
  const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(FB_CONFIG);
  _fbDb = firebase.database();
  _fbAuth = firebase.auth();
  // 전역 노출 (다른 script에서 window._fbDb 사용 가능하게)
  window._fbDb = _fbDb;
  window._fbAuth = _fbAuth;
  
  // 세션 영속화 — index.html에서 LOCAL persistence로 저장된 Google 세션 복원
  _authReady = (async () => {
    try {
      await _fbAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    } catch(_){}
    return new Promise((resolve) => {
      const unsub = _fbAuth.onAuthStateChanged(u => {
        unsub();
        if(u && !u.isAnonymous){
          console.log('[Auth] Google 세션 복원:', u.uid);
          resolve(u);
        } else {
          console.warn('[Auth] 정상 세션 없음 — ELO 업데이트 불가');
          resolve(null);
        }
      });
      setTimeout(() => resolve(null), 8000);
    });
  })();
  window._authReady = _authReady;
};
