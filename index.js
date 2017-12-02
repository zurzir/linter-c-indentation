'use babel'

export function activate() {
    // Fill something here, optional
}

export function deactivate() {
    // Fill something here, optional
}

export function provideLinter() {
    return {
        name: 'Indentação',
        scope: 'file', // or 'project'
        lintsOnChange: false, // or true
        grammarScopes: ['source.c', 'source.cpp'],
        lint(textEditor) {
            // Do something async
            return new Promise(function(resolve) {
                const editorPath = textEditor.getPath()
                const nrows = textEditor.getLastScreenRow()
                var notes = []
                var lastSug = -1, lastCur = -1
                for (row = 0; row < nrows; row++) {
                    const text = textEditor.lineTextForBufferRow(row)
                    const indent = text.match(/^\s*/)[0]
                    const endColumn = indent.length
                    const sugIndent = textEditor.suggestedIndentForBufferRow(row)
                    const curIndent = textEditor.indentationForBufferRow(row)

                    const matchComment = text.match(/^\s*([/][/])/)
                    if (matchComment) {
                        if (row + 1 < nrows) {
                            // se essa linha começa um comentário e a próxima não
                            // é compatível
                            if (curIndent < textEditor.indentationForBufferRow(row+1)) {
                                notes.push({
                                    severity: 'info',
                                    location: {
                                        file: editorPath,
                                        position: [[row, matchComment[0].length-2], [row, matchComment[0].length]],
                                    },
                                    excerpt: `Comentário confuso`,
                                    description: `O comentário atual não está alinhado com o código que o segue`
                                })
                            }
                        }
                        // workaround pq o atom não aumenta a indentação qnd o bloco começa com comentario
                        if (row > 1) {
                            // se essa linha começa um comentário e a anterior aumenta indentação
                            const incIndent = textEditor.lineTextForBufferRow(row-1).match(/[{]\s*$/); //}
                            // console.log(textEditor.indentationForBufferRow(row-1))
                            // console.log(curIndent)
                            if (incIndent && curIndent <= textEditor.indentationForBufferRow(row-1)) {
                                notes.push({
                                    severity: 'info',
                                    location: {
                                        file: editorPath,
                                        position: [[row, 0], [row, endColumn]],
                                    },
                                    excerpt: `Início de bloco não indentação`,
                                    description: `O nível de indentação da linha atual deve ser aumentado`
                                })
                            }
                        }
                    }


                    const matchSpace = indent.match(/^\s*? /)
                    if (matchSpace && !textEditor.getSoftTabs()) {
                        notes.push({
                            severity: 'info',
                            location: {
                                file: editorPath,
                                position: [[row, matchSpace[0].length - 1], [row, matchSpace[0].length]],
                            },
                            excerpt: `Espaço inválido`,
                            description: `O modo de indentação atual do editor é com tabs e foi encontrado espaço. Substitua os espaços por tab, ou use o modo soft tabs.`
                        })
                    }

                    const matchTab = indent.match(/^\s*?\t/)
                    if (matchTab && textEditor.getSoftTabs()) {
                        notes.push({
                            severity: 'info',
                            location: {
                                file: editorPath,
                                position: [[row, matchTab[0].length - 1], [row, matchTab[0].length]],
                            },
                            excerpt: `Tab inválido`,
                            description: `O modo de indentação atual do editor é com espaço e foi encontrado tab. Substitua os tab por espaços, ou use o modo tabs.`
                        })
                    }

                    if (endColumn != 0 && sugIndent != curIndent && !(lastSug == sugIndent && lastCur == curIndent)) {
                        notes.push({
                            severity: 'info',
                            location: {
                                file: editorPath,
                                position: [[row, 0], [row, endColumn]],
                            },
                            excerpt: `Nível de indentação inapropriado`,
                            description: `A linha está indentada por por ${curIndent} níveis de indentação. Seria mais claro utilizar ${sugIndent} níveis.`
                        })
                    }
                    lastSug = sugIndent
                    lastCur = curIndent
                }

                resolve(notes)
            })
        }
    }
}
