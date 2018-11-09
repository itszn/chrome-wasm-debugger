var port = chrome.runtime.connect({name: "console"});
var term;

var funcs = {};
var funcs_by_name = {};

function dm(name) {
    if (!name.startsWith('__'))
        return name;
    res = demangle(name);
    if (res == null)
        return name;
    return res;
}

var qs = {};
var state = 'finding';
port.onMessage.addListener(msg => {
    console.log("Got message %O",msg);
    if (msg.type in qs && qs[msg.type].length > 0) {
        qs[msg.type].splice(0,1)[0](msg);
        return;
    }
    if (msg.type === 'found_scripts') {
        funcs = msg.funcs;
        state = 'loading';
        term.echo(`Found ${Object.keys(funcs).length} WASM functions`);
    }
    if (msg.type === 'loaded_scripts') {
        funcs = msg.funcs;
        for (let f of Object.values(funcs)) {
            f.dm_name = dm(f.name).split('(',1)[0];

            funcs_by_name[f.name] = f;
            if (f.name !== f.dm_name)
                funcs_by_name[f.dm_name] = f;
        }

        if (state == 'finding')
            term.echo(`Found ${Object.keys(funcs).length} WASM functions`);
        state == 'ready';
        term.echo(`Loaded wasm disassembly`);
    }
    if (msg.type === 'paused') {
        let func = funcs[msg.f];
        term.echo(`Execution paused at ${func.dm_name}:${msg.l}`)
        for (let i=msg.l-3; i<msg.l; i++) {
            let l = get_source_line(func, i);
            if (l === null) continue;
            term.echo(`    ${i}:  ${get_source_line(func, i)}`);
        }
        term.echo(`--> ${msg.l}:  ${get_source_line(func, msg.l)}`);
        for (let i=msg.l+1; i<msg.l+4; i++) {
            let l = get_source_line(func, i);
            if (l === null) break;
            term.echo(`    ${i}:  ${l}`);
        }
        term.echo('Stack:');
        for (let i=0;i<msg.stack.length;i++) {
            term.echo(` ${i}: 0x${msg.stack[i].toString(16)}`);
        }
    }
    if (msg.type === 'print') {
        if (msg.error !== undefined) {
            term.error(msg.error);
        } else {
            term.echo(msg.echo);
        }
    }
});

function send(type, msg) {
    msg.type = type;
    if (!(type in qs))
        qs[type] = [];
    return new Promise((resolve, reject) => {
        qs[type].push(resolve);
        port.postMessage(msg);
    });
}

function annotate_dis(line) {
    let m = line.match(/\s*call (\d+)/);
    console.log(m);
    if (m) {
        let fn = parseInt(m[1]);
        if (!(fn in funcs))
            return line;
        return line + ` <${funcs[fn].dm_name}>`
    }
    return line;
}

function get_func(name) {
    if (name in funcs_by_name)
        return funcs_by_name[name];

    name_ = '_'+name;
    if (name_ in funcs_by_name)
        return funcs_by_name[name_];

    let iname = parseInt(name);
    if (!(iname in funcs)) {
        throw(`Could not find function '${name}'`);
    }
    return funcs[iname];
}

function cmd_disassembly(cmd_) {
    let cmd = cmd_.split(' ');
    let dis = get_func(cmd[1]);
    dis = dis.source.split('\n');

    let out = ''
    for (let i=0; i<dis.length; i++) {
        out += `${i}:  ${annotate_dis(dis[i])}\n`;
    }

    term.echo(out);
}

function get_source_line(f,n) {
    if (f.split_source === undefined)
        f.split_source = f.source.split('\n');
    let dis = f.split_source;
    if (n < 0) return null;
    if (n >= dis.length) return null;
    return dis[n];
}

function cmd_break(cmd_) {
    let cmd = cmd_.split(' ');
    let addr = cmd[1].split(':');
    if (addr.len < 2)
        throw(`Invalid break address '${cmd[1]}'`);

    let func = get_func(addr[0]);
    if (!func)
        throw(`Invalid function '${addr[0]}'`);

    let line = parseInt(addr[1]);
    if (isNaN(line) || line < 0)
        throw(`Invalid line number '${addr[1]}'`);

    let lt = annotate_dis(get_source_line(func, line));
    if (lt === null)
        throw(`Invalid line number '${addr[1]}'`);

    term.echo(`Setting breakpoint at ${func.dm_name}:${lt}`);
    send('cmd_break', {f:func.id, l:line}).then(m=>{
        if (!m.success)
            term.error(m.error);
    });

}

function cmd_si(cmd_) {
    send('cmd_si', {}).then(m=>{
        if (!m.success)
            term.error(m.error);
    });
}

function zpad(v, l) {
    if (v < 0)
        v += 0xffffffff
    let a = v.toString(16);
    if (a.length == l)
        return a;
    console.log(a.length,a);
    return '0'.repeat(l-a.length)+a;
}

function parse(expr) {
    return Promise.resolve(window.parser.parse(expr));
}

function cmd_x(cmd_) {
    let cmd = cmd_.split(' ');
    let expr = cmd.slice(1).join(' ');
    cmd = cmd[0];

    let size = 4;
    let num = 32;
    if (cmd[1] === '/') {
        cmd = cmd.split('/')[1];
        if (cmd.indexOf('w') !== -1)
            size = 4;
        else if (cmd.indexOf('b') !== -1)
            size = 1;
        num = parseInt(cmd.replace(/[bwxs]/g,''),10);
    }
    parse(expr).then(addr=>{
        send('cmd_read_mem', {addr:addr, len: num, size:size}).then(d=>{
            let mem = d.mem;
            let smem = mem;
            if (size > 1) {
                smem = new Array(mem.length/size);
                for (let i=0; i<smem.length; i++) {
                    let a = 0;
                    for (let j=size-1; j>=0;j--) {
                        a <<= 8;
                        a += mem[i*size+j];
                    }
                    smem[i] = a;
                }
            }
            for (let i=0; i<smem.length;) {
                out = `0x${zpad(addr+size*i, 8)}: `;
                for (let j=0; j<{4:4,1:16}[size] && i<smem.length; j++, i++) {
                    out += ` 0x${zpad(smem[i],size*2)}`;
                }
                term.echo(out);
            }
        });
    });
}

function cmd_c(cmd_) {
    send('cmd_continue',{})
}

function cmd_i(cmd_) {
    let cmd = cmd_.split(' ');
    if (cmd[1].startsWith('f')) {
        for (let f of Object.values(funcs)) {
            term.echo(`${f.dm_name} at ${f.id}`);
        }
    }
}

var lastcmd = null;

jQuery(function($, undefined) {
    term = $('#term').terminal(function(cmd) {
        if (cmd === '' && lastcmd !== null)
            cmd = lastcmd;
        lastcmd = cmd;
        if (cmd.startsWith('disas'))
            return cmd_disassembly(cmd)
        if (cmd.startsWith('break'))
            return cmd_break(cmd)
        if (cmd == 'si')
            return cmd_si(cmd)
        if (cmd == 'c')
            return cmd_c(cmd)
        if (cmd.startsWith('x'))
            return cmd_x(cmd);
        if (cmd.startsWith('i'))
            return cmd_i(cmd);
    }, {
        greetings: 'Loading WASM debugger...',
        height: 600,
        prompt: 'wdb> '
    })
});

