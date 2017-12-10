'use babel'

export function activate() {
    // Fill something here, optional
}

export function deactivate() {
    // Fill something here, optional
}

function hasScope(token, scope) {
    for (let s of token.scopes) {
        if (s == scope)
            return true;
    }
    return false;
}

function hasInScope(token, scope) {
    for (let s of token.scopes) {
        if (s.indexOf(scope) != -1)
            return true;
    }
    return false;
}
l = console.log

function getLineIndentLevel(text, tabLength) {
    var spaceInRow = 0;
    var level = 0;
    for (let c of text) {
        if (c == ' ') {
            spaceInRow++;
            if (spaceInRow == tabLength) {
                spaceInRow = 0;
                level++;
            }
        } else if (c == '\t') {
            spaceInRow = 0; // ignores any space which does not add up to tabLength
            level++;
        }
    }
    return level;
}

export function provideLinter() {
    return {
        name: 'Indentação',
        scope: 'file',
        lintsOnChange: false,
        grammarScopes: ['source.c'],
        lint(textEditor) {
            // Do something async
            return new Promise(function(resolve) {
                grammar = atom.grammars.grammarForScopeName("source.c")
                const editorPath = textEditor.getPath()
                const usingTabs = !textEditor.getSoftTabs()
                const tabLength = atom.config.get('editor.tabLength');
                const tokenSets = grammar.tokenizeLines(textEditor.getText())

                console.log(tokenSets)

                var notes = []

                var blockLevel = 0;
                var indentNext = false; // indents next line if currently in "if" or "while"
                var condKW = ''; // conditional keyword
                var condPrevKW = '';
                var condParenLevel = 0; // level of brackets after conditional command
                var condStmAfter = false; // if there is a statement after condition

                for (let line = 0; line < tokenSets.length; line++) {
                    // check indentation
                    const text = textEditor.lineTextForBufferRow(line)
                    const indent = text.match(/^\s*/)[0]
                    //console.log(`-${indent}-`)
                    var curIndent = getLineIndentLevel(indent, tabLength)
                    var sugIndent = blockLevel
                    //  if previous statement is a one-line conditional statement and next token is not '{'
                    if (indentNext && !text.match(/\s*\{/)) {
                        sugIndent++
                    }
                    // if starts with closing bracket }
                    if (text.match(/\s*\}/)) {
                        sugIndent--;
                    }

                    // if has wrong indentation
                    if (text != indent && curIndent != sugIndent) {
                        var endColumn
                        textOneLine = ''
                        if (indentNext) {
                            textOneLine = `Observe que o comando ${condKW} anterior
                            se aplica apena a essa linha!`
                        }
                        notes.push({
                            severity: 'warning',
                            location: {
                                file: editorPath,
                                position: [[line, 0], [line, indent.length]],
                            },
                            excerpt: `Nível de indentação inapropriado`,
                            description: `A linha está indentada por por ${curIndent} níveis de indentação. Seria mais claro utilizar ${sugIndent} níveis. ${textOneLine}`
                        })
                    }

                    // checks mismatch use of spaces and tabs
                    const matchSpace = indent.match(/^\s*? /)
                    if (matchSpace && usingTabs) {
                        notes.push({
                            severity: 'warning',
                            location: {
                                file: editorPath,
                                position: [[line, matchSpace[0].length - 1], [line, matchSpace[0].length]],
                            },
                            excerpt: `Espaço inválido`,
                            description: `O modo de indentação atual do editor é com tabs e foi encontrado espaço. Substitua os espaços por tab, ou use o modo soft tabs.`
                        })
                    }
                    const matchTab = indent.match(/^\s*?\t/)
                    if (matchTab && !usingTabs) {
                        notes.push({
                            severity: 'warning',
                            location: {
                                file: editorPath,
                                position: [[line, matchTab[0].length - 1], [line, matchTab[0].length]],
                            },
                            excerpt: `Tab inválido`,
                            description: `O modo de indentação atual do editor é com espaço e foi encontrado tab. Substitua os tab por espaços, ou use o modo tabs.`
                        })
                    }

                    for (let token of tokenSets[line]) {

                        // checks for statement after condition
                        if (!hasScope(token, 'punctuation.terminator.statement.c')) {
                            if (hasScope(token, 'punctuation.section.parens.begin.bracket.round.c')) {
                                if (indentNext) {
                                    condParenLevel++;
                                }
                            } else if (hasScope(token, 'punctuation.section.parens.end.bracket.round.c')) {
                                if (indentNext) {
                                    condParenLevel--;
                                }
                            } else {
                                // is not a comment and has nom
                                if (condParenLevel == 0 && !hasInScope(token, 'comment') && token.value.match(/\S/)) {
                                    condStmAfter = true;
                                }
                            }
                        }

                        // parses token
                        if (hasScope(token, 'punctuation.section.block.begin.bracket.curly.c')) {
                            // token '{'
                            indentNext = false
                            blockLevel++
                        } else if (hasScope(token, 'punctuation.section.block.end.bracket.curly.c')) {
                            // token '}'
                            blockLevel--
                            if (blockLevel < 0)
                                blockLevel = 0
                        } else if (hasScope(token, 'keyword.control.c')) {
                            // token 'keyword'
                            if (token.value == 'if' || token.value == 'for' || token.value == 'else'
                                || token.value == 'while') {


                                condPrevKW = condKW;
                                condKW = token.value;

                                // nested condition (allows only else if)
                                if (indentNext && (condPrevKW != 'else' || condKW != 'if')) {
                                    const colStart = text.indexOf(condKW);
                                    const colEnd = colStart + condKW.length;
                                    notes.push({
                                        severity: 'warning',
                                        location: {
                                            file: editorPath,
                                            position: [[line, colStart], [line, colEnd]],
                                        },
                                        excerpt: `Condição aninhada`,
                                        description: `Você está colocando um comando ${condKW} como bloco de outro comando ${condPrevKW}. ` +
                                                     `Use ${condPrevKW} (...) { ${condKW} (...) ... } para ficar mais claro.`
                                    })
                                }

                                indentNext = true;
                                condParenLevel = 0;
                                condStmAfter = false;


                            }


                        } else if (hasScope(token, 'punctuation.terminator.statement.c')) {
                            if (condParenLevel == 0) {
                                if (indentNext && !condStmAfter) {
                                    notes.push({
                                        severity: 'warning',
                                        location: {
                                            file: editorPath,
                                            position: [[line, text.indexOf(';')], [line, text.indexOf(';')+1]],
                                        },
                                        excerpt: `Bloco vazio`,
                                        description: `Observe que o comando ${condKW} irá executar um bloco vazio que termina no ponto e vírgula ';'.`
                                    })
                                }
                                indentNext = false;
                            }
                        }
                    }
                }

                resolve(notes)
            })
        }
    }
}
