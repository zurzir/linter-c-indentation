const l = console.log;

// lines must be an array of strings containing the lines
// allTokens must be an array of arrays of tokens,
// each token is { startIndex, endIndex, value , scopes}
// scopes is an array of textmate scopes
module.exports.checkIndent = function(filePath, useTabs, tabLength, lines, allTokens) {
    let notes = [];
    let firstTokens = Array(allTokens.length);

    class ConditionStack {
        constructor() {
            this.conditions = [[]]; // for each block, the stack of conds
        }
        num() {
            return this.conditions[this.conditions.length - 1].length;
        }
        last() {
            let s = this.conditions[this.conditions.length - 1];
            return s[s.length - 1];
        }
        reset() {
            this.conditions[this.conditions.length - 1] = [];
        }
        add(condition) {
            this.conditions[this.conditions.length - 1].push(condition);
        }
        del() {
            this.conditions[this.conditions.length - 1].pop();
        }
        push() {
            this.conditions.push([]);
        }
        pop() {
            this.conditions.pop();
            // asserts that always there is at least one state
            if (this.conditions.length == 0) {
                this.push();
            }
        }
    }

    function getSpaceTabLevels(text, tabLength) {
        var spaceInARow = 0;
        var tabLevel = 0;
        var spaceLevel = 0;
        for (var c of text) {
            if (c == ' ') {
                spaceInARow += 1;
                if (spaceInARow == tabLength) {
                    spaceInARow = 0;
                    spaceLevel += 1;
                }
            } else if (c == '\t') {
                spaceInARow = 0; // ignores any space which does not add up to tabLength
                tabLevel += 1;
            } else {
                break;
            }
        }
        return { tabLevel, spaceLevel, remainingSpaces: spaceInARow };
    }

    function getIndentLevel(text, tabLength) {
        let { tabLevel, spaceLevel, remainingSpaces } = getSpaceTabLevels(text, tabLength);
        let indentLevel = tabLevel + spaceLevel;
        return { indentLevel, remainingSpaces };
    }

    function inScope(token, scope) {
        for (let curScope of token.scopes) {
            if (curScope.indexOf(scope) != -1)
                return true;
        }
        return false;
    }

    function getNextTokenValue(line, i) {
        var firstIdx = i + 1;
        for (var nextLine = line; nextLine < allTokens.length; nextLine++) {
            for (var nextIdx = firstIdx; nextIdx < allTokens[nextLine].length; nextIdx++) {
                var nextToken = allTokens[nextLine][nextIdx];
                if (inScope(nextToken, 'comment'))
                    continue;
                if (nextToken.value.trim() == '')
                    continue;
                return nextToken.value;
            }
            firstIdx = 0;
        }
        return null;
    }

    function getTokenLocation(line, token) {
        return {
            'file': filePath,
            'position': [
                [line, token.startIndex],
                [line, token.endIndex]
            ]
        };
    }

    function getLineStartLocation(line, index) {
        return {
            'file': filePath,
            'position': [
                [line, 0],
                [line, index]
            ]
        };
    }

    function getLineLocation(line) {
        return getLineStartLocation(line, 0);
    }

    function pushNote(location, excerpt, description='', severity='warning') {
        notes.push({
            'severity': severity,
            'location': location,
            'excerpt': excerpt,
            'description': description
        });
    }

    function setLevels() {
        // states
        var curLevel = 0;
        var parenthesesAfterCond = -1; // number of paren after condition; -1 means no condition
        var numberParentheses = 0; // overall number of paren
        var lastValue = '';
        var nextIsDoWhile = false; // true if next token is a while that close do { ..} while
        var condStack = new ConditionStack();

        // for each line
        for (var line = 0; line < allTokens.length; line++) {

            // for each token in line
            for (var i = 0; i < allTokens[line].length; i++) {
                var token = allTokens[line][i];
                let nextTokenValue = getNextTokenValue(line, i);

                // token takes current level
                token.level = curLevel;

                // ignore white space tokens
                if (token.value.trim() == '')
                    continue;

                // implicit increase of level after condition
                if (parenthesesAfterCond == 0
                    && !inScope(token, 'comment')
                    && !['(', '{'].includes(token.value))
                {
                    curLevel += 1;
                    token.level += 1;
                    parenthesesAfterCond = -1;
                }

                // virtual end of statement (for invalid syntax)
                // "else" is first non empty token in a line
                // and last nonempty token has not closed the condition
                // and there have been token after condition (because paren == -1)
                if (token.value == 'else'
                    && !firstTokens[line]
                    && ![';', '}'].includes(lastValue)
                    && condStack.num() > 0
                    && parenthesesAfterCond == -1)
                {
                    curLevel -= 1;
                    token.level -= 1;
                    condStack.del();
                }

                // punctuation
                if (inScope(token, 'punctuation')) {

                    if (token.value == '{') {
                        parenthesesAfterCond = -1;
                        condStack.push();
                        curLevel += 1;

                    } else if (token.value == '}') {
                        condStack.pop();

                        if (condStack.num() > 0) {

                            nextIsDoWhile = condStack.last() == 'do'
                                            && nextTokenValue == 'while';

                            if (nextTokenValue == 'else' || nextIsDoWhile) {
                                curLevel -= 1;
                                condStack.del();
                            } else {
                                curLevel -= condStack.num();
                                condStack.reset();
                            }
                            token.level -= 1;
                        } else {
                            curLevel -= 1;
                            token.level = curLevel;
                        }

                    } else if (token.value == ';' && condStack.num() > 0 && parenthesesAfterCond == -1) {
                        if (nextTokenValue == 'else') {
                            curLevel -= 1;
                            condStack.del();
                        } else {
                            curLevel -= condStack.num();
                            condStack.reset();
                        }
                    }

                    if (['[', '('].includes(token.value)) {
                        curLevel += 1;
                        numberParentheses += 1;
                    } else if ([']', ')'].includes(token.value)) {
                        curLevel -= 1;
                        token.level -= 1;
                        numberParentheses -= 1;
                        if (numberParentheses < 0)
                            numberParentheses = 0;
                    }

                    if (parenthesesAfterCond >= 0) {
                        if (token.value == '(') {
                            parenthesesAfterCond += 1;
                        } else if (token.value == ')') {
                            parenthesesAfterCond -= 1;

                            // this ")" closes the condition
                            if (parenthesesAfterCond == 0) {
                                // and the statement is empty
                                let lastCond = condStack.last();
                                if (nextTokenValue == ';'
                                    && ['if', 'while', 'for', 'else', 'switch'].includes(lastCond))
                                {
                                    pushNote(getTokenLocation(line, token), 'Cuidado: bloco vazio',
                                        `O comando "${lastCond}" contém\
                                        um bloco vazio; todos os comandos depois de ";"\
                                        não fazem parte do "${lastCond}" correpondente.`);
                                }
                            }
                        }
                    }
                }

                // special treatment for cases
                else if (inScope(token, 'keyword') && ['default', 'case'].includes(token.value)) {
                    token.level -= 1;
                }

                // condition
                else if (inScope(token, 'keyword')
                    && ['if', 'while', 'for', 'else', 'do', 'switch'].includes(token.value))
                {
                    if (lastValue == 'else' && token.value == 'if') {
                        curLevel -= 1;
                        token.level -= 1;
                        condStack.del();

                        // when "if" is the first token in line and is separated from else
                        // asks to put they together
                        if (!firstTokens[line]) {
                            pushNote(getTokenLocation(line, token), 'Uso de "else if"',
                                'Você está usando uma construção "else if";\
                                 mas o "if" está sozinho; seria mais claro\
                                 colocar o "if" logo depois do "else" na\
                                 mesma linha');
                        }
                    }

                    // this token creates a nested condition
                    // we only alert on the first if
                    // in a chain of if else if...
                    // and thus we alternate on the condition above
                    // we also do not alert on the while of "do ... while"
                    else if (token.value != 'else' && condStack.num() > 0 && !nextIsDoWhile) {
                        let lastCond = condStack.last();
                        var optionalText = lastCond == 'else' ? '' : '(...) ';
                        pushNote(getTokenLocation(line, token), 'Condições aninhadas',
                            `Você está colocando um comando "${token.value}" como bloco de \
                             outro comando "${lastCond}".\
                             Revise o código e se for isso mesmo que você quer,\
                             use "${lastCond}" ${optionalText}{ "${token.value}" (...) ... } \
                             para ficar mais claro.`);
                    }

                    // there must be a condition next
                    parenthesesAfterCond = 0;

                    if (nextIsDoWhile) {
                        // uses a different marker to distinguish "while" from do-while
                        // to the normal "while"
                        condStack.add('do_while');
                        nextIsDoWhile = false;
                    } else {
                        condStack.add(token.value);
                    }
                }

                // saves last non comment token
                if (!inScope(token, 'comment')) {
                    lastValue = token.value;
                }

                // saves line first token
                if (!firstTokens[line]) {
                    firstTokens[line] = token;

                    // check if the first tok is inside a parentheses expression
                    let isOpeningPar = ['[', '('].includes(token.value) && numberParentheses == 1;
                    let isClosingPar = [']', ')'].includes(token.value) && numberParentheses == 0;
                    token.inparen = (!isOpeningPar && numberParentheses > 0) || isClosingPar
                    token.nextTokenValue = nextTokenValue;
                }
            }
        }

        // normalize levels
        for (var line = firstTokens.length - 1, lastLevel = 0, lastValue = '';
            line >= 0; line--) {
            // creates dummy token for each empty line; such tokens get level of next line token
            if (!firstTokens[line]) {
                firstTokens[line] = {
                    value: '',
                    startIndex: 0,
                    endIndex: 0,
                    level: lastLevel
                };
            }

            // comments gets level of next line token
            if (firstTokens[line].value == '//' && lastValue != '')
                firstTokens[line].level = firstTokens[line + 1].level;

            lastLevel = firstTokens[line].level;
            lastValue = firstTokens[line].value;
        }
    }

    function checkLines() {
        // check each line
        var lastIndentLevel = 0;
        var lastErrorReported = false; // do not report errors for consecutive lines
        var lastFirstTokenLevel = 0;

        for (var line = 0; line < lines.length; line++) {
            // the first token in the line
            let firstToken = firstTokens[line];
            let lineText = lines[line];

            // ignores problems on empty lines
            if (lineText.trim() == '')
                continue;

            // calculates suggested and real indent
            var diff = firstToken.level - lastFirstTokenLevel;
            lastFirstTokenLevel = firstToken.level
            let { indentLevel, remainingSpaces } = getIndentLevel(lineText, tabLength);
            var suggestedIndent = diff + lastIndentLevel;

            // l(line+1, indentLevel, suggestedIndent);

            // this makes thing less worse...
            if (suggestedIndent < 0)
                suggestedIndent = 0;
            lastIndentLevel = indentLevel;

            // checks tab/space
            if (!inScope(firstToken, 'comment')) {
                var msg, desc, rexp;
                if (useTabs) {
                    rexp = /^(\t*)( +)/;
                    msg = 'Uso de espaço ao invés de tab';
                    desc = 'O editor está configurado para usar tabs,\
                            mas essa linha contém espaços como indentação.';
                } else {
                    rexp = /(^ *)(\t+)/;
                    msg = 'Uso de tab ao invés de espaço';
                    desc = 'O editor está configurado para usar espaços,\
                            mas essa linha contém tabs como indentação.';
                }
                var m = rexp.exec(lineText);
                if (m !== null) {
                    pushNote(getLineLocation(line), msg, desc);
                }
            }

            // allow expressions in parentheses to be more indented
            if (indentLevel > suggestedIndent && firstToken.inparen) {
                lastIndentLevel = suggestedIndent;
                lastErrorReported = false;
                continue;
            }

            // checks remaining spaces
            if (remainingSpaces > 0 && (!inScope(firstToken, 'comment') || firstToken.value.startsWith('//'))) {
                var dels = tabLength*(indentLevel - suggestedIndent) + remainingSpaces;
                var actionText;
                if (dels > 0)
                    actionText = `Remova ${dels} espaço(s) dessa linha.`;
                else
                    actionText = `Insira ${-dels} espaços nessa linha.`;
                pushNote(getLineLocation(line), 'Número de espaços ruim',
                    `O número de espaços não é múltiplo da largura\
                    do tab. ${actionText}`);
            }

            // if everything is ok, continues
            if (indentLevel == suggestedIndent) {
                lastErrorReported = false;
                continue;
            }

            // easy down on the error reporting:
            // this allows that an indentation error on a single
            // line be reported only once
            if (lastErrorReported) {
                lastErrorReported = false;
                continue;
            }

            // ignore comments that do not start with //
            if (inScope(firstToken, 'comment') && !firstToken.value.startsWith('//')) {
                lastIndentLevel = suggestedIndent;
                continue;
            }

            // allows comment to be over indented, if it ends a block
            if (inScope(firstToken, 'comment') && firstToken.nextTokenValue == '}') {
                // could be overindent by one level
                if(indentLevel == suggestedIndent + 1) {
                    lastIndentLevel--;
                    continue;
                }
            }

            // adds note
            pushNote(getLineStartLocation(line, firstToken.startIndex), 'Mal indentado',
                `Está indentado em ${indentLevel} níveis, mas era\
                 melhor com ${suggestedIndent} níveis. Corrija todo\
                 o bloco que segue!`);
            lastErrorReported = true;
        }
    }

    // entry point
    setLevels();
    checkLines();

    return notes;
}
