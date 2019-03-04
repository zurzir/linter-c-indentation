'use babel';

import {checkIndent} from './checkIndent.js'

const l = console.log;

var grammar;

export function activate() {
    // FIXME: Usa o registro das gramáticas do texmate
    if (typeof(atom.grammars.textmateRegistry) === "undefined")
        grammar = atom.grammars.grammarForScopeName('source.c');
    else
        grammar = atom.grammars.textmateRegistry.grammarForScopeName('source.c');
}

export function provideLinter() {
    return {
        name: 'Indentação',
        scope: 'file',
        lintsOnChange: true,
        grammarScopes: ['source.c'],
        lint: async (editor) => {
            let filePath = editor.getPath();
            let useTabs = !editor.getSoftTabs();
            let tabLength = editor.getTabLength();
            let text = editor.getText();
            let lines = text.split(/\r?\n/);
            var allTokens = grammar.tokenizeLines(text);
            for (lineTokens of allTokens) {
                var index = 0;
                for (token of lineTokens) {
                    token.startIndex = index;
                    index += token.value.length;
                    token.endIndex = index;
                }
            }
            return checkIndent(filePath, useTabs, tabLength, lines, allTokens);
        }
    };
}
