Expression
  = head:Term tail:(_? ("+" / "-") _? Term)* {
        return tail.reduce(function(result, element) {
            var a = result;
            var b = element[3];

            return Promise.all([a, b]).then(function(args) {
                if (element[1] === '+')
                    return parseInt(args[0] + args[1]);
                if (element[1] === '-')
                    return parseInt(args[0] - args[1]);
            });
        }, head);
    }

Term
  = head:Factor tail:(_? ("*" / "/") _? Factor)* {
        return tail.reduce(function(result, element) {
            var a = result;
            var b = element[3];

            return Promise.all([a, b]).then(function(args) {
                if (element[1] === '*')
                    return parseInt(args[0] * args[1]);
                if (element[1] === '/')
                    return parseInt(args[0] / args[1]);
            });
        }, head);
    }

Factor
    = "(" _? expr:Expression _? ")" { return expr; }
    / Dereference
    / Token

Dereference
    = parts:( "*(" _? expr:Expression _? ")" / "*" _? expr:Token ) {
        //console.log(parts);
        var expr = parts[2];
        //console.log(expr);
        var addr = expr;
        return new Promise(function(resolve, reject) {
            reject("Dereference not supported");
        });
    }

Token "token"
    = Integer
    / Register
    / Symbol

//Integer has extra rules at the end to make sure it consumes the whole token.
//Otherwise symbols starting with a number will be consumed instead
Integer "integer"
    = _? '0x' dig:$([0-9a-fA-F]+) & (_ / [)+\-*/] / !.) {
        return parseInt(dig, 16);
    }
    / _? dig:$([0-9]+) & (_ / [)+\-*/] / !.){
        return parseInt(text(), 16);
    }

Register "register"
    = _? '$'reg:$([a-zA-Z0-9]+) {
        return new Promise(function(resolve, reject) {
            reject("Registers not supported");
        });
    }

Symbol "symbol"
    = _? '&'? sym:$([a-zA-Z0-9_\-]+) {
        return new Promise(function(resolve, reject) {
            reject("Symbols not supported");
        });
    }

_ "whitespace"
    = [ \t\n\r]+

