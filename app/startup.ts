/** Runs in the head before startup artwork can paint; no account data is persisted. */
export const startupNavigationScript = `(()=>{try{if(performance.getEntriesByType("navigation")[0]?.type==="reload")document.documentElement.setAttribute("data-startup","reload")}catch{}})();`;
