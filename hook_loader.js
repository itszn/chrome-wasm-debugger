var s = document.createElement('script');
let u = chrome.extension.getURL('hook.js');
console.log(u);
s.src = u;
s.onload = function() {
    this.parentNode.removeChild(this);
};
(document.head || document.documentElement).appendChild(s);
