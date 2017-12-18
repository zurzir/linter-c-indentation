'use babel';

// const atom_linter = require('atom-linter');
import atom_linter from 'atom-linter';

const l = console.log;

var grammar;

export function activate() {
    const packpath = atom.packages.getLoadedPackage('linter-simple-format').path;
    this.pyscript = [packpath, 'check_indent.py'].join('/');
    grammar = atom.grammars.grammarForScopeName('source.c');
}
function inScope(tok, scope) {
    for (let s of tok.scopes) {
        if (s.indexOf(scope) != -1)
            return true;
    }
    return false;
}

function _get_line_indent_level(text, tabLength) {
    var space_in_a_row = 0;
    var tab_level = 0;
    var space_level = 0;
    for (var c of text) {
        if (c == ' ') {
            space_in_a_row += 1;
            if (space_in_a_row == tabLength) {
                space_in_a_row = 0;
                space_level += 1;
            }
        } else if (c == '\t') {
            space_in_a_row = 0; // ignores any space which does not add up to tabLength
            tab_level += 1;
        } else {
            break;
        }
    }
    return { tab_level, space_level, remaining_spaces: space_in_a_row };
}

function get_line_indent_level(text, tabLength) {
    let { tab_level, space_level, remaining_spaces } = _get_line_indent_level(text, tabLength);
    let indent_level = tab_level + space_level;
    return { indent_level, remaining_spaces };
}

function nextToken(toks, line, i) {
    var t = null;
    // l("antes", line+1,  toks[line][i].value)

    while (true) { // eslint-disable-line
        t = null;
        if (i + 1 < toks[line].length) {
            i += 1;
            t = toks[line][i];
        } else if (line + 1 < toks.length) {
            line += 1;
            i = 0;
            t = toks[line][i];
        }
        if (t === null)
            break;
        else if (inScope(t, 'comment'))
            continue;
        else if (t.value.trim() == '')
            continue;
        else
            break;
    }
    // l("depois", t ? t.value : 'null')
    return t;
}

function nextTokIs(toks, line, i, name) {
    let nt = nextToken(toks, line, i);
    return nt !== null && nt.value == name;
}

function _get_tok_col(toks, tok) {
    var pos = 0;
    for (var j = 0; j < tok.i; j++)
        pos += toks[tok.line][j].value.length;
    return pos;
}

function makeLocation(toks, from, to, file) {
    var from_col = _get_tok_col(toks, from);
    var to_col = _get_tok_col(toks, to) + toks[to.line][to.i].value.length;
    return {
        'file': file,
        'position': [
            [from.line, from_col],
            [to.line, to_col]
        ]
    };
}

function makeNote(location, excerpt, description='', severity='warning') {
    return {
        'severity': severity,
        'location': location,
        'excerpt': excerpt,
        'description': description
    };
}

function checkIndent(filePath, useTabs, tabLength, text) {
    var toks = grammar.tokenizeLines(text);
    var lines = text.split('\n');
    var notes = [];

    // states
    var line;
    var level = 0;
    var paren = -1; // number of paren after condition
    var num_paren = 0; // overall number of paren
    var nextIsDoWhile = false;
    var last = '';
    var levs = Array(lines.length);
    var first_tok_info = Array(lines.length);
    for (line = 0; line < lines.length; line++) {
        levs[line] = -1;
    }

    // encapsulates implicit indentation increases
    var _conditions = [[]]; // for each block, the stack of conds
    function cond_num() {
        return _conditions[_conditions.length-1].length;
    }
    function cond_last() {
        let s = _conditions[_conditions.length-1];
        return s[s.length - 1];
    }
    function cond_reset() {
        _conditions[_conditions.length-1] = [];
    }
    function cond_add(cond) {
        _conditions[_conditions.length-1].push(cond);
    }
    function cond_del() {
        _conditions[_conditions.length-1].pop();
    }
    function cond_push() {
        _conditions.push([]);
    }
    function cond_pop() {
        _conditions.pop();
        // asserts that always there is at least one state
        if (_conditions.length == 0) {
            cond_push();
        }
    }

    cond_push();
    console.clear();
    // for each token
    for (line = 0; line < lines.length; line++) {
        for (var i = 0; i < toks[line].length; i++) {
            let t = toks[line][i];
            let s = t.value;
            let tok_level = level;
            var closing_par = false;
            if (s.trim() == '')
                continue;
            // l("1:", line + 1, tok_level, s)

            // implicit increase of level
            if (paren == 0 && !inScope(t, 'comment') && !['(', '{'].includes(s)) {
                level += 1;
                tok_level += 1;
                paren = -1;
            }

            // virtual end of statement
            // if "else" is first non empty token in a line
            // and last nonempty token has not closed the condition
            // and there have been token after condition (because paren == -1)
            if (s == 'else'
                && !first_tok_info[line]
                && ![';', '}'].includes(last)
                && cond_num() > 0
                && paren == -1)
            {
                l(line+1, 'virt', t);
                level -= 1;
                tok_level -= 1;
                cond_del();
            }

            // punctuation
            if (inScope(t, 'punctuation')) {

                if (s == '{') {
                    paren = -1;
                    cond_push();
                    level += 1;
                } else if (s == '}') {
                    cond_pop();
                    l(line + 1, 'cn', level, cond_num(),
                        _conditions[_conditions.length-1].toString()
                    );
                    if (cond_num() > 0) {
                        var isIfElse = nextTokIs(toks, line, i, 'else');
                        nextIsDoWhile = cond_last() == 'do'
                                        && nextTokIs(toks, line, i, 'while');
                        l(isIfElse, nextIsDoWhile)
                        if (isIfElse || nextIsDoWhile) {
                            level -= 1;
                            cond_del();
                        } else {
                            level -= cond_num();
                            cond_reset();
                        }
                        tok_level -= 1;
                    } else {
                        level -= 1;
                        tok_level = level;
                    }
                } else if (s == ';' && cond_num() > 0 && paren == -1) {
                    if (nextTokIs(toks, line, i, 'else')) {
                        level -= 1;
                        cond_del();
                    } else {
                        level -= cond_num();
                        cond_reset();
                    }
                }

                if (['[', '('].includes(s)) {
                    level += 1;
                    num_paren += 1;
                } else if ([']', ')'].includes(s)) {
                    level -= 1;
                    tok_level -= 1;
                    if (num_paren == 1)
                        closing_par = true;
                    num_paren -= 1;
                    if (num_paren < 0)
                        num_paren = 0;
                }

                if (paren >= 0) {
                    if (s == '(') {
                        paren += 1;
                    } else if (s == ')') {
                        paren -= 1;

                        // this ")" closes the condition
                        // and the statement is empty
                        var nt = nextToken(toks,line,i);
                        var last_cond = cond_last();
                        l(line + 1, 'vaz', cond_num(), last_cond, nt.value);
                        if (nt !== null
                             && nt.value == ';'
                             && ['if', 'while', 'for', 'else', 'switch'].includes(last_cond))
                        {
                            var loc = makeLocation(toks,{line,i}, {line,i},filePath);
                            notes.push(makeNote(loc, 'Bloco vazio',
                                `O comando "${last_cond}" contém\
                                um bloco vazio; todos os comandos depois de ";"\
                                não fazem parte do "${last_cond}" correpondente.`));
                            l(line + 1, 'do', level, cond_num(),
                                _conditions[_conditions.length-1].toString()
                            );

                        }
                    }
                }
            }

            // condition
            if (inScope(t, 'keyword') && s == 'case') {
                tok_level -= 1;
            } else if (inScope(t, 'keyword')
                && ['if', 'while', 'for', 'else', 'do', 'switch'].includes(s))
            {
                // l(line+1, 'cond', t)
                if (last == 'else' && s == 'if') {
                    level -= 1;
                    tok_level -= 1;
                    cond_del();

                    // when "if" is alone in the next line,
                    // asks to put they together
                    if (!first_tok_info[line]) {
                        loc = makeLocation(toks,
                            {line, i}, {line, i},
                            filePath);
                        notes.push(makeNote(loc, 'Uso de "else if"',
                            'Você está usando uma construção "else if";\
                            mas o "if" está sozinho; seria mais claro\
                            colocar o "if" logo depois "else" na\
                            mesma linha'
                        ));
                    }
                }
                // this token creates a nested condition
                // we only alert on the first if
                // in a chain of if else if...
                // and thus we alternate on the condition above
                // we also do not alert on the while of "do ... while"
                else if (s != 'else' && cond_num() > 0 && !nextIsDoWhile) {
                    var last_cond = cond_last();
                    var loc = makeLocation(toks, {line, i}, {line, i}, filePath);
                    var txt_parent = last_cond == 'else' ? '' : '(...) ';

                    notes.push(makeNote(loc, 'Condições aninhadas',
                        `Você está colocando um comando "${s}" como bloco de \
                         outro comando "${last_cond}".\
                         Use "${last_cond}" ${txt_parent}{ "${s}" (...) ... } \
                         para ficar mais claro.`));
                }


                paren = 0;
                if (nextIsDoWhile) {
                    // uses a different marker to distinguish "while" from do-while
                    // to the normal "while"
                    cond_add('do_while');
                    nextIsDoWhile = false;
                } else {
                    l(line + 1, 'condica', s);
                    cond_add(s);
                    l(_conditions[_conditions.length-1].toString());
                }

            }

            if (!inScope(t, 'comment')) {
                last = s;
                if (levs[line] == -1)
                    levs[line] = tok_level;
            }

            if (!first_tok_info[line]) {
                first_tok_info[line] = {
                    'tok': {line, i},
                    'inparen': num_paren > 0 || closing_par
                };
            }
        }
    }

    // undefined levels get next level;
    // so leading comments get level of next line
    var last_lev;
    last_lev = 0; // last lines with undefined level gets level 0
    for (line = lines.length - 1; line >= 0; line--) {
        if (levs[line] == -1)
            levs[line] = last_lev;
        last_lev = levs[line];
    }

    // check each line
    var last_indent_level = 0;
    last_lev = 0;
    for (line = 0; line < lines.length; line++) {
        let txt = lines[line];

        // ignores problems on empty lines
        if (txt.trim() == '')
            continue;

        var diff = levs[line] - last_lev;
        last_lev = levs[line];

        // calculates suggested and real indent
        let { indent_level, remaining_spaces } = get_line_indent_level(txt, tabLength);
        var suggest_indent = diff + last_indent_level;
        last_indent_level = indent_level;
        l(`${line+1} ${levs[line]} ${diff}: ${suggest_indent} -- ${indent_level}|${txt}`);

        // useful variables
        var info = first_tok_info[line];
        var first_tok = info['tok'];
        var t = toks[first_tok.line][first_tok.i];

        // checks tab/space
        if (!inScope(t, 'comment')) {
            var msg, rexp;
            if (useTabs) {
                rexp = /^(\t*)( +)/;
                msg = 'Uso de espaço ao invés de tab';
            } else {
                rexp = /(^ *)(\t+)/;
                msg = 'Uso de tab ao invés de espaço';
            }
            var m = rexp.exec(txt);
            if (m !== null) {
                loc = makeLocation(toks,
                    {'line': line, 'i': 0},
                    {'line': line, 'i': 0},
                    filePath);
                notes.push(makeNote(loc, msg));
            }
        }


        // checks reamaining spaces
        if (remaining_spaces > 0) {
            loc = makeLocation(toks,
                {'line': line, 'i': 0},
                {'line': line, 'i': 0},
                filePath);
            notes.push(makeNote(loc, 'Espaços a mais',
                `Remova ${remaining_spaces} espaços dessa linha`));
        }

        // if everything is ok, continues
        if (indent_level == suggest_indent)
            continue;


        // allow expressions in parent to be more indented
        if (indent_level > suggest_indent && info['inparen']) {
            last_indent_level = suggest_indent;
            continue;
        }

        // adds note
        l('erro');
        loc = makeLocation(toks, {'line': line, 'i': 0}, first_tok, filePath);
        notes.push(makeNote(
            loc, 'Mal indentado',
            `Está indentado em ${indent_level} níveis, mas era\
             melhor com ${suggest_indent} níveis. Corrija todo\
             o bloco que segue!`));
    }

    return notes;

}

export function provideLinter() {

    return {
        name: 'Indentação',
        scope: 'file',
        lintsOnChange: false,
        grammarScopes: ['source.c'],
        lint: async (editor) => {
            let filePath = editor.getPath();
            let useTabs = !editor.getSoftTabs();
            let tabLength = editor.getTabLength();
            return checkIndent(filePath, useTabs, tabLength, editor.getText());
            const args = [
                this.pyscript, '-j', useTabs ? '-t' : '-s',
                '-l', tabLength.toString(), filePath
            ];
            var out;
            try {
                out = await atom_linter.exec('python3', args);
            } catch (err) {
                // atom.notifications.addError("Aconteceu algum erro");
                l('erro ao executar aquivo');
                l(err);
                return [];
            }
            try {
                var notes = JSON.parse(out);
            } catch(err) {
                l('erro ao analisar json');
                l(err);
            }
            l('ok');
            return notes;
        }
    };
}
