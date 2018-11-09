let logStyle = (style, ...args) => {
    let args_ = args;
    if (typeof(args[0]) === 'string') {
        args_ = ['%c'+args[0], style, ...(args.slice(1))];
    }
    console.log(...args_);
}

let logDebug = (...args) => logStyle('color: green', ...args);
let logInfo = (...args) => logStyle('color: yellow', ...args);

logInfo("Loaded hook");

let logGet = (obj, prop) => {
    let r = obj[prop];
    logDebug('Get on %O for %O resulted in %O', obj, prop, r);
    return r;
}

let logGetCtx = (ctx) => (obj, prop) => {
    let r = obj[prop];
    logDebug('Get on %O (%O) for %O resulted in %O', obj, ctx, prop, r);
    return r;
}

let logConstruct = (obj, args) => {
    logDebug('Constructing %O with args %O', obj ,args);
    return new obj(...args);
}

let logFunction = (obj,f) => (...args) => {
    logDebug('Calling function %O.%O with %O', obj, f, args);
    let res = f(...args);
    console.log('  --> %O', res);
    return res;
}

let logApply = (f, thisArg, args) => {
    logDebug('Calling function %O with %O', f, args);
    let res = f(...args);
    console.log('  --> %O', res);
    return res;
}


let memory_objects = [];

let objHook_Memory = new Proxy(WebAssembly.Memory, {
    get: logGet,
    construct: (obj, args) => {
        let res = logConstruct(obj,args);
        memory_objects.push(res);
        return res;
    }
})

let table_objects = [];

let objHook_Table = new Proxy(WebAssembly.Table, {
    get: logGet,
    construct: (obj, args) => {
        let res = logConstruct(obj,args);
        table_objects.push(res);
        return res;
    }
});

let instances = [];

class DebugInstance {
    constructor(source, imports) {
        this.soruce = source;
        this.imports = imports;
        this.instance = null;
        this.module = null;

        this.tried_to_start = false;
    }
}

let proxyExports = (di, exports) => {
    let out = {};
    for (let n in exports) {
        if (typeof(exports[n]) !== 'function') {
            out[n] = exports[n];
            continue;
        }
        logInfo("Export? %O",exports[n]);
        out[n] = new Proxy(exports[n], {
            get: logGetCtx('exports['+n+']'),
            apply: (f, thisArg, args) => {
                if (!di.tried_to_start) {
                    debugger;
                }
                di.tried_to_start = true;
                return logApply(f, thisArg, args);
            },
        });
    }
    return out;
}

let proxyInstance = (di, inst) => {
    return new Proxy(inst, {
        get: (obj, prop) => {
            let r = logGetCtx('instance')(obj, prop);
            if (prop === 'exports') {
                console.log(r);
                return proxyExports(di, r);
            }
            return r;
        }
    });
}

logInfo("wasm is %O",window.WebAssembly);

window.WebAssembly = new Proxy(WebAssembly, {
    get: (obj, prop) => {
        let r = logGet(obj, prop);
        if (prop === 'Memory')
            return objHook_Memory;
        if (prop === 'Table')
            return objHook_Table;
        if (prop === 'instantiateStreaming')
            return (...args) => Promise.reject('Debug streaming is disabled');
        if (prop === 'instantiate')
            return (source, imports) => {
                logInfo('Hooking instantiate, called with imports %O', imports);
                let di = new DebugInstance(source, imports);
                if (instances.length > 0) {
                    console.error("Currently this plugin does not support multiple wasm instances!");
                    throw("Currently this plugin does not support multiple wasm instances!");
                }
                instances.push(di);

                let proxyImports = {};
                for (let n in imports) {
                    proxyImports[n] = new Proxy(imports[n], {
                        get: logGetCtx('imports['+n+']')
                    });
                }

                return obj.instantiate(source, proxyImports).then(r => {
                    di.instance = r.instance;
                    di.module = r.module
                    r.instance = proxyInstance(di, r.instance);
                    r.module = new Proxy(r.module, {
                        get: logGetCtx('module')
                    });
                    return r;
                });
            }
            return logFunction(obj, r);

        return r;
    }
});

