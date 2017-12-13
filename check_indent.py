#!/usr/bin/env python3

import argparse
import re
import json

from clang.cindex import Config, Index, Cursor, CursorKind, TokenKind, Diagnostic, SourceLocation, SourceRange

DEBUG = False

Config.set_library_file('/usr/lib/x86_64-linux-gnu/libclang-5.0.so.1')

class CheckIndent(object):
    # pylint: disable=R0902
    def __init__(self, filename, use_tab, tab_length, syntax_errror):
        self.tab_length = tab_length
        self.use_tab = use_tab
        self.filename = filename
        self.syntax_error = syntax_errror
        self.notes = []
        with open(filename) as f:
            self.line_texts = [txt.rstrip() for txt in f] # strip \n
        # insert blank line, so indices correpond to real lines
        self.line_texts.insert(0, '')
        self.index = Index.create()
        self.tu = self.index.parse(self.filename, ['-nostdinc'])
        self.parse_ok = True
        for d in self.tu.diagnostics:
            # print(d)
            self.parse_ok = self.add_clang_diag(d) and self.parse_ok
        if not self.tu:
            raise Exception("Erro de sintaxe; não verificando")
        self.tok_levels = {}
        self.tokens = {}
        self.cursor_info = {}

        self.last_displayed_line = -1

    def add_clang_diag(self, diagnostic: Diagnostic):
        s = diagnostic.severity
        if s == Diagnostic.Ignored:
            s = 'info'
            # return True
        elif s == Diagnostic.Note:
            severity = 'info'
        elif s == Diagnostic.Warning:
            severity = 'warning'
        else: # s == Diagnostic.Error or s == Diagnostic.Fatal
            severity = 'error'
        line, col = self.loc(diagnostic)
        pos = [[line,col], [line, col+1]]
        desc = diagnostic.spelling
        cat_number = diagnostic.category_number
        excerpt = "{} ({})".format(diagnostic.category_name, str(cat_number))
        # ignore include errors
        if cat_number == 1 and desc.find('file not found'):
            return True
        if self.syntax_error:
            self.add_note(pos, excerpt, desc, severity)
        return s != Diagnostic.Fatal

    def add_note(self, position, excerpt, description=None, severity='warning'):
        if description is None:
            description = ''
        self.notes.append({
            'severity': severity,
            'location': {'file': self.filename, 'position': position},
            'excerpt': excerpt,
            'description': description
        })

    def detect_indent_type(self):
        tab_lines = space_lines = 0
        for text in self.line_texts:
            t, s = self._get_line_indent_level(text)
            if t > s:
                tab_lines += 1
            elif t < s:
                space_lines += 1
        self.use_tab = tab_lines > space_lines

    def _get_line_indent_level(self, text):
        space_in_a_row = 0
        tab_level = 0
        space_level = 0
        for c in text:
            if c == ' ':
                space_in_a_row += 1
                if space_in_a_row == self.tab_length:
                    space_in_a_row = 0
                    space_level += 1
            elif c == '\t':
                space_in_a_row = 0 # ignores any space which does not add up to tabLength
                tab_level += 1
            else:
                break
        return tab_level, space_level

    def get_line_indent_level(self, text):
        tab_level, space_level = self._get_line_indent_level(text)
        return tab_level + space_level

    @staticmethod
    def loc(tok):
        return (tok.location.line, tok.location.column)

    @staticmethod
    def make_pos(from_tok, to_tok=None):
        if to_tok is None:
            to_tok = from_tok
        return [[from_tok.location.line, from_tok.location.column],
                [to_tok.location.line, to_tok.location.column + len(to_tok.spelling)]]

    def _dump_ast(self, cursor, level):
        print(' '*level, cursor.kind)
        for c in cursor.get_children():
            self._dump_ast(c, level + 1)

    def dump_ast(self):
        self._dump_ast(self.tu.cursor, 0)

    def update_toks_level(self, toks, cursor, block_level):
        for t in toks:
            loc = self.loc(t)
            self.tokens.setdefault(loc, t)
            # stores the deepest cursor and block_level associated with the location
            self.cursor_info[loc] = cursor
            self.tok_levels[loc] = block_level

    def visit(self, cursor, n_child, parent, p_toks, block_level):
        kind = cursor.kind
        p_kind = parent and parent.kind
        toks = list(cursor.get_tokens())

        # verifica condições aninhadas sem {
        cond = [CursorKind.IF_STMT,
                CursorKind.WHILE_STMT,
                CursorKind.FOR_STMT,
                CursorKind.DO_STMT,
                CursorKind.SWITCH_STMT]
        # primeiro verifica if () {} else if () {} (quando é o terceiro filho)
        if kind == CursorKind.IF_STMT and p_kind == CursorKind.IF_STMT and n_child == 3:
                block_level -= 1
        # demais
        elif kind in cond and p_kind in cond:
            pos = self.make_pos(p_toks[0], toks[0])
            desc = 'Você está colocando um comando {1} como bloco de outro comando {0}. ' + \
                   'Use {0} (...) {{ {1} (...) ... }} para ficar mais claro.'
            desc = desc.format(p_toks[0].spelling, toks[0].spelling)
            self.add_note(pos, 'Condições aninhadas', desc)

        # first check empty statements
        if kind == CursorKind.NULL_STMT:
            pos = self.make_pos(p_toks[0], toks[0])
            command = p_toks[0].spelling
            if command != '{': # se não é um bloco {} vazio
                desc = 'Note que o comando "{}" não executa NENHUM subcomando depois do ";"'.format(command)
                self.add_note(pos, 'Bloco vazio', desc)
            block_level += 1
            self.update_toks_level(toks, {'cursor':cursor, 'n_child': n_child}, block_level)

        # a curly bracket always increments the level
        elif kind == CursorKind.COMPOUND_STMT:
            block_level += 1
            # but not of the  toks { and }
            self.update_toks_level(toks[1:-1], {'cursor':cursor, 'n_child': n_child}, block_level)

        # if this is a case statment, we should decrese
        # the indentation of the first token,
        elif kind == CursorKind.CASE_STMT:
            self.update_toks_level(toks[0:1], {'cursor':cursor, 'n_child': n_child}, block_level - 1)
            # updates the cursor corresponding to remaining tokens (the level does not change)
            self.update_toks_level(toks[1:], {'cursor':cursor, 'n_child': n_child}, block_level)

        # declarando
        elif kind == CursorKind.DECL_STMT:
            # does  not indent first token
            self.update_toks_level(toks[:1], {'cursor':cursor, 'n_child': n_child, 'first_tok': True}, block_level)
            block_level += 1
            self.update_toks_level(toks[1:], {'cursor':cursor, 'n_child': n_child, 'first_tok': False}, block_level)

        # other cases for indentation
        elif p_kind in [CursorKind.IF_STMT,
                        CursorKind.WHILE_STMT,
                        CursorKind.FOR_STMT,
                        CursorKind.DO_STMT,
                        CursorKind.SWITCH_STMT,
                        CursorKind.PAREN_EXPR,
                        CursorKind.INIT_LIST_EXPR,
                        CursorKind.FUNCTION_DECL]:
            block_level += 1
            self.update_toks_level(toks, {'cursor': parent, 'n_child': n_child}, block_level)

        n = 1
        for c in cursor.get_children():
            self.visit(c, n, cursor, toks, block_level)
            n += 1

    def check_tabs(self):
        first_col = [-1]*len(self.line_texts) # first col in a comment at line
        def update_first_col(first_col, line, col):
            if first_col[line] == -1 or first_col[line] > col:
                first_col[line] = col
        for t in self.tu.cursor.get_tokens():
            if t.kind == TokenKind.COMMENT:
                ls = t.extent.start.line
                cs = t.extent.start.column
                le = t.extent.end.line
                update_first_col(first_col, ls, cs)
                for l in range(ls + 1, le + 1):
                    update_first_col(first_col, l, 1)
        # for l in range(1, len(self.line_texts)):
        #     print(l, first_col[l])

        if self.use_tab:
            rexp = r'^(\t*)( +)'
            msg = 'Uso de espaço ao invés de tab'
        else:
            rexp = r'(^ *)(\t+)'
            msg = 'Uso de tab ao invés de espaço'
        for line, txt in enumerate(self.line_texts):
            m = re.match(rexp, txt)
            if m:
                col = len(m.group(1)) + 1
                len_offending = len(m.group(2))
                # if space is not in a comment
                if first_col[line] == -1 or first_col[line] > col:
                    # print(line, first_col[line], col)
                    pos = [[line, col], [line, col + len_offending]]
                    f = self.tu.get_file(self.filename)
                    # a = SourceLocation.from_position(self.tu, f, line, col)
                    # b = SourceLocation.from_position(self.tu, f, line + len_offending, 1)
                    # r = SourceRange.from_locations(a, b)
                    # print([t.spelling for t in toks])
                    self.add_note(pos, msg)

    # pylint: disable=R0914
    def check_indent(self):
        # first set level 0 to all tokens
        self.update_toks_level(self.tu.cursor.get_tokens(), {'cursor': self.tu.cursor, 'n_child': 1}, 0)

        self.visit(self.tu.cursor, 1, None, [], 0)

        # calculates the relative difference in indentation between two lines
        # we consider a mistake only when this difference is not assured
        difs = [0]*len(self.line_texts)
        line = 0
        last_lev = 0
        difs[0] = 0
        first_locs = [None] * len(self.line_texts)
        for loc, lev in sorted(self.tok_levels.items()):
            if line == loc[0]:
                continue
            line, _ = loc
            first_locs[line] = loc
            difs[line] = lev - last_lev
            last_lev = lev
            if DEBUG:
                print("%2d:%2d   %d  %2d %10s |%s" % (line, loc[1], lev, difs[line], self.tokens[loc].spelling[:10], self.line_texts[line]))

        # check indentation
        last_indent = 0 # indentation in the last line
        last_reported = False # keep track of last error (do not report consecutive indentation errors)
        for line, txt in enumerate(self.line_texts):
            if txt.strip() == '':
                continue
            indent = self.get_line_indent_level(txt)
            suggested = last_indent + difs[line]
            report_error = False
            if suggested != indent:
                loc = first_locs[line]
                tok = self.tokens[loc]
                # se for um case, então relaxa restrição (deixa indentar junto dos comandos ou antes)
                # pylint: disable=E1101
                if tok.kind == TokenKind.KEYWORD and \
                        tok.spelling == 'case' and \
                        indent == suggested + 1:
                    indent = suggested # finge ter feito correto
                else:
                    loc_end = tuple(self.loc(tok))
                    loc_start = [loc_end[0], 1]
                    pos = [loc_start, loc_end]
                    if not last_reported:
                        info = self.cursor_info[loc]
                        k = info['cursor'].kind
                        ok = False
                        # when indentation is larger than suggested, then ignore in some cases
                        if indent > suggested:
                            if k in [CursorKind.IF_STMT, CursorKind.WHILE_STMT, CursorKind.SWITCH_STMT]:
                                # if tok is in the  "condition"
                                ok = info['n_child'] == 1
                            elif k == CursorKind.FOR_STMT:
                                # if tok is not in the last child of for, it is in an expression
                                ok = info['n_child'] < len(list(info['cursor'].get_children()))
                            elif k in [CursorKind.FOR_STMT, CursorKind.FUNCTION_DECL]:
                                # if tok is not in the last child of for, it is in an expression
                                # or if to i not in the last child of fuct, it is a param decla
                                ok = info['n_child'] < len(list(info['cursor'].get_children()))
                            elif k == CursorKind.DO_STMT:
                                # if tok is second
                                ok = info['n_child'] == 2
                            elif k in [CursorKind.PAREN_EXPR, CursorKind.INIT_LIST_EXPR]:
                                ok = True
                            elif k == CursorKind.DECL_STMT:
                                ok = not info['first_tok']
                        if ok:
                            indent = suggested # finge ter feito correto
                        if not ok:
                            desc = 'Está indentado em %d níveis, mas era melhor com %d níveis. Corrija todo o bloco que segue!' % (indent, suggested)
                            self.add_note(pos, 'Indentacao errada', desc)
                            report_error = True

            last_reported = report_error
            last_indent = indent

        # for t in self.tu.cursor.get_tokens():
        #     print(t.location)
            # print(self.tok_levels[t], t.spelling)
        # for i, txt in enumerate(self.line_texts):
        #     line = i + 1

    def print_note(self, note, context):
        start, end = note['location']['position']
        start_col = start[1]
        end_col = end[1]
        line = end[0]
        if start[0] != line:
            start_col = 0
        text = self.line_texts[line]
        start_col += text[:start_col].count('\t')*(self.tab_length-1)
        end_col += text[:end_col].count('\t')*(self.tab_length-1)
        for i in range(max(1, line - context, self.last_displayed_line), line + 1):
            text = self.line_texts[i].replace('\t', '-' * (self.tab_length-1) + '>')
            print('{:2}: {}'.format(i, text))
        self.last_displayed_line = line
        s = ' ' * (start_col + 3)
        s += '-' * (end_col - start_col - 1)
        s += '^ ' + note['excerpt']
        print(s)
        print('   ', note['description'])
        print()


    def sort_notes(self):
        self.notes = sorted(self.notes, key=lambda n: n['location']['position'][0])

    def print_notes(self, context):
        for n in self.notes:
            self.print_note(n, context)


def main():
    parser = argparse.ArgumentParser(description='Verifica indentação')
    parser.add_argument('-t', dest='use_tabs', action='store_true', help='Indentação com tabs')
    parser.add_argument('-s', dest='use_spaces', action='store_true', help='Indentação com espaços')
    parser.add_argument('-o', dest='syntax_errror', action='store_false', help='Omite erros de sintaxe do clang')
    parser.add_argument('filename', metavar='arquivo.c', help='Nome do arquivo .c ou .h')
    parser.add_argument('-l', dest='tab_length', type=int, default=4, help='Tamanho da tabulação (padrão 4)')
    parser.add_argument('-j', dest='json_output', action='store_true', help='Saída em formato json para linter do atom')
    parser.add_argument('-d', dest='debug', action='store_true', help='Debug')
    args = parser.parse_args()

    global DEBUG
    DEBUG = args.debug

    if args.tab_length < 1 or args.tab_length > 16:
        print("Tamanho da tabulação inválida")
        return

    if args.use_tabs and args.use_spaces:
        print("Utilize -s ou -t; não ambos")
        return

    checker = CheckIndent(args.filename, args.use_tabs, args.tab_length, args.syntax_errror)
    if not args.use_tabs and not args.use_spaces:
        checker.detect_indent_type()
        kind = 'tabs' if checker.use_tab else 'espaços'
        if not args.json_output:
            print("Indentação detectada como usando", kind, "\n")
    if DEBUG:
        checker.dump_ast()
    checker.check_indent()
    checker.check_tabs()
    # print(checker.notes)
    checker.sort_notes()
    if args.json_output:
        # convert indices to atom format
        for n in checker.notes:
            for i in range(2):
                line, col = n['location']['position'][i]
                n['location']['position'][i] = [line -1, col -1]
        print(json.dumps(checker.notes))
    else:
        checker.print_notes(3)

if __name__ == '__main__':
    main()
