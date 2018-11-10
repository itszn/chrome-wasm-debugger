This is a pretty feature bare gdb style debugger for WASM webpages.
It works by using proxies to hook WASM module operations and providing a gdb view to set breakpoints and inspect memory.

This is currently only has a few features but works alright for some debugging some WASM memory corruption.
The main feature is the easy of reading module memory.

### How To
- Enable the extension
- Go to the page you want to debug and open the dev tools, the proxy hooks should start working.
- Click the extension icon to open the debugger
- Reload the page you want to debug. The debugger should say it loaded some wasm functions
- Now you can set breakpoints in the debugger
- Refreshing the original page will keep breakpoints and rerun the wasm

### Features
- `i f` to get a list of functions
- `disassemble <function name or number>` Print the disassembly (via chrome) of the function. Can use function index number instead of name.
- `break <function>:<line>` Set a break point on a given line of the disassembly (via chrome)
- `si` Single step
- `c` Continue execution
- `x/<num>[bhw][xd] <address>` Examine memory like gdb. Must be broken to use.
- Printing stack values on step

### Limitiations
- Many
- Cannot see locals
- Currently only works for a single page. If you change debug targets you will have to reload the plugin
- Cannot catch crashes
- Not sure how it would handle thread stuff but might be ok
- No removing breakpoints atm

