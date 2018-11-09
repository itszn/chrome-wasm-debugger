// Copyright (c) 2011 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

var attachedTabs = {};
var version = "1.0";

var tabMap = {};

chrome.debugger.onEvent.addListener(onEvent);
chrome.debugger.onDetach.addListener(onDetach);

chrome.browserAction.onClicked.addListener(function(tab) {
  var tabId = tab.id;
  var debuggeeId = {tabId:tabId};

  if (attachedTabs[tabId] == "pausing")
    return;

  if (!attachedTabs[tabId])
    chrome.debugger.attach(debuggeeId, version, onAttach.bind(null, debuggeeId));
  else if (attachedTabs[tabId])
    chrome.debugger.detach(debuggeeId, onDetach.bind(null, debuggeeId));
});

var g_tab;

function getProps(obj,d) {
    if (d === undefined)
        d = g_tab;

    let id = obj;
    if (obj.objectId)
        id = obj.objectId

    return new Promise((resolve, reject) => {
        chrome.debugger.sendCommand(g_tab, 'Runtime.getProperties', {
            objectId: id,
            ownProperties:true
        }, res => {
            if (res === undefined)
                return reject(chrome.runtime.lastError);
            let out = {};
            console.log(res);
            for (let p of res.result) {
                out[p.name] = p.value;
            }
            resolve(out);
        });
    });
}


var script_cache = {};

class WasmDebugger {
    constructor(tabid) {
        this.tabid = tabid;
        this.wasm_functions = {};
        this.state = 'getting_scripts';
        this.wasm_url = null;
        this.wasm_id = null;
        this.console_tab = null;
        this.port = null;
        this.to = null;
        this.hit_start_break = false;
        this.set_all_breakpoints = false;

        this.mem_obj = null;

        this.breakpoints = [];

        this.portMessage = this.portMessage.bind(this);
    }

    reset() {
        this.wasm_functions = {};
        this.wasm_id = null;
        this.mem_obj = null;
        this.hit_start_break = false;
        this.set_all_breakpoints = false;
    }

    setAllBreakpoints() {
        if (this.set_all_breakpoints)
            return;
        this.set_all_breakpoints = true;
        let ps = [];
        for(let b of this.breakpoints) {
            ps.push(new Promise((resolve, reject) => {
                this.setBreakPoint(`${this.wasm_id}-${b.f}`, b.l, res => {
                    console.log("set break -->",res);
                    resolve();
                });
            }));
        }
        Promise.all(ps).then(()=>{
            this.continueExecution();
        });
    }

    getProps(id) {
    }

    foundAllScripts() {
        console.log("Done getting scripts -->",this.wasm_functions);
        this.state = 'loading_scripts';
        this.sendMessage('found_scripts',{funcs:this.wasm_functions});

        if (this.hit_start_break) {
            this.setAllBreakpoints();
        }

        if (!(this.wasm_url in script_cache)) {
            script_cache[this.wasm_url] = {};
        }
        let cache = script_cache[this.wasm_url];
        for (let f in this.wasm_functions) {
            if (!(f in script_cache)) {
                ((f) => {
                    chrome.debugger.sendCommand(this.tabid, "Debugger.getScriptSource", {
                        scriptId: `${this.wasm_id}-${f}`
                    }, (res) => {
                        cache[f] = res.scriptSource;
                        let source = res.scriptSource;
                        let name = source.split('\n',1)[0].split('$',2)[1].split(' ')[0];
                        //let name = `sub_${f}`;

                        this.wasm_functions[f].source = source;
                        this.wasm_functions[f].name = name;

                        for (let f in this.wasm_functions) {
                            if (this.wasm_functions[f].source === undefined)
                                return
                        }
                        this.sendMessage('loaded_scripts',{funcs:this.wasm_functions});
                        this.state = 'ready';
                    });
                })(f);
            } else {
                this.wasm_functions[f].source = res.scriptSource;
            }
        }
    }

    portMessage(msg) {
        console.log("Got message %O",msg);
        if (msg.type === 'cmd_break') {
            this.setBreakPoint(`${this.wasm_id}-${msg.f}`, msg.l, res => {
                if (res === undefined)
                    return this.sendMessage('cmd_break',{
                        success:false, error:chrome.runtime.lastError.message});
                this.breakpoints.push({f:msg.f,l:msg.l});
                return this.sendMessage('cmd_break',{success:true, id:res.breakpointId});
            });
            return;
        }
        if (msg.type === 'cmd_si') {
            this.stepInstruction(res=>{
                if (res !== undefined)
                    return this.sendMessage('cmd_break',{success:true});
                return this.sendMessage('cmd_break',{
                    success:false, error:chrome.runtime.lastError.message});
            });
        }
        if (msg.type === 'cmd_read_mem') {
            this.readMem(msg.addr, msg.len, msg.size).then(r=>{
                this.sendMessage('cmd_read_mem',{success:true, mem:r});
            }).catch(e=>{
                console.error(e);
                this.sendMessage('cmd_read_mem',{success:false});
            });
        }
        if (msg.type === 'cmd_continue') {
            this.continueExecution(res=>{
                if (res !== undefined)
                    return this.sendMessage('cmd_break',{success:true});
                return this.sendMessage('cmd_break',{
                    success:false, error:chrome.runtime.lastError.message});
            });
        }
    }

    continueExecution(cb) {
        chrome.debugger.sendCommand(this.tabid, "Debugger.resume", {}, (res)=>{
                console.log("Debugger.resume -->",res);
                if (cb)
                    cb(res);
        });
    }

    stepInstruction(cb) {
        chrome.debugger.sendCommand(this.tabid, "Debugger.stepInto", {}, (res)=>{
                console.log("Debugger.stepInto -->",res);
                if (cb)
                    cb(res);
        });

    }

    readMem(addr, len, size) {
        return new Promise((resolve, reject) => {
          chrome.debugger.sendCommand(this.tabid, "Runtime.callFunctionOn", {
              functionDeclaration:
                  `function(){
                    let out = new Array(${len});
                    let arr = new Uint8Array(this);
                    for (let i=0; i<${len*size}; i++) {
                      out[i] = arr[${addr}+i];
                    }
                    return out;
                  }`,
                  objectId: this.mem_obj,
                  returnByValue: true,
          }, res=>{
              if (res === undefined)
                  return reject(chrome.runtime.lastError.message);
              resolve(res.result.value);
          });
        })
    }

    sendMessage(type, msg) {
        msg.type = type;
        this.port.postMessage(msg);
    }

    setBreakPoint(s,l,cb) {
        chrome.debugger.sendCommand(this.tabid, "Debugger.setBreakpoint", {
                location: {
                    lineNumber: l,
                    scriptId: s,
                }
            },
            (res)=>{
                console.log("Debugger.setBreakpoint -->",res);
                if (cb)
                    cb(res);
            }
        );
    }
}

chrome.runtime.onConnect.addListener(port => {
    console.log("Connect %O",port);
    let tab = port.sender.tab;
    let m = tabMap[tab.id];
    m.port = port;
    port.onMessage.addListener(m.portMessage);
    if (m.state === 'ready') {
        m.sendMessage('loaded_scripts',{funcs:m.wasm_functions});
    }
    // TODO send other state when broken
});

function onAttach(debuggeeId) {
  g_tab = debuggeeId;
    console.log(debuggeeId)
  if (chrome.runtime.lastError) {
    alert(chrome.runtime.lastError.message);
    return;
  }

  var tabId = debuggeeId.tabId;

  chrome.browserAction.setIcon({tabId: tabId, path:"debuggerPausing.png"});
  chrome.browserAction.setTitle({tabId: tabId, title:"Pausing JavaScript"});

  tabMap[tabId] = new WasmDebugger(debuggeeId);

  attachedTabs[tabId] = "pausing";
  chrome.debugger.sendCommand(
      debuggeeId, "Debugger.enable", {});
  chrome.tabs.create({ url: chrome.runtime.getURL("console.html") }, tab => {
      let m = tabMap[tabId];
      tabMap[tab.id] = m;
      console.log(tab.id);
      m.console_tab = tab.id;
  });
}

function onEvent(debuggeeId, method, params) {
  var tabId = debuggeeId.tabId;
  if (method == "Debugger.paused") {
      console.log("paused -->",params);
      let m = tabMap[tabId];
      if (!m) return;
      let loc = params.callFrames[0].location;
      let sid = loc.scriptId.split('-');
      console.log(sid, m.wasm_id);

      if (!m.hit_start_break) {
          m.hit_start_break = true;
          if (m.state != 'getting_scripts') {
              m.setAllBreakpoints();
          }
      }

      if (sid[0] !== m.wasm_id) return;

      getProps(params.callFrames[0].scopeChain[0].object, tabId).then(p=>{
          m.mem_obj = p.memory.objectId;
      });

      getProps(params.callFrames[0].scopeChain[1].object, tabId)
      .then(p=>getProps(p.stack, tabId)).then(s=>{
          console.log(s);
          let stack = [];
          for (let i=0; ;i++) {
              if (!(i in s))
                  break;
              stack.push(s[i].value)
          }
          m.sendMessage('paused', {
              f: parseInt(sid[1]),
              l: loc.lineNumber,
              stack: stack
          });
      });
  }
  if (method == 'Debugger.scriptParsed') {
      let m = tabMap[tabId];
      if (!m) return;

      if (params.url.startsWith('wasm://')) {
          let funcnum_ = params.scriptId.split('-')[1];
          let funcnum = parseInt(funcnum_)
          let url = params.url.slice(0,-1-funcnum_.length);

          if (m.state !== 'getting_scripts') {
              if (m.wasm_url === url) {
                  m.sendMessage('print',{echo: 'Module recreated, reloading...'});
                  console.log("Reloaded page!");
                  m.reset();
                  m.wasm_id = null;
                  m.state = 'getting_scripts';
              } else {
                  m.sendMessage('print',{error: 'Unknown wasm module loaded??'});
                  return; 
              }
          }

          if (m.wasm_url === null)
              m.wasm_url = url;
          if (m.wasm_id === null)
              m.wasm_id = params.scriptId.split('-')[0];
          m.wasm_functions[funcnum] = {'scriptId':params.scriptId, 'id':funcnum}
          if (m.to !== null) {
              clearTimeout(m.to)
          }
          m.to = setTimeout(()=>{
              m.to = null;
              m.foundAllScripts();
          },500);
      } else if (m.state === 'getting_scripts' && m.wasm_id !== null) {
          m.foundAllScripts();
      }
  }

}

function onDetach(debuggeeId) {
  var tabId = debuggeeId.tabId;
  delete attachedTabs[tabId];
  chrome.browserAction.setIcon({tabId:tabId, path:"debuggerPause.png"});
  chrome.browserAction.setTitle({tabId:tabId, title:"Pause JavaScript"});
}
