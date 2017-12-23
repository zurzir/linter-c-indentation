#!/usr/bin/env python3

import argparse
import re
import json

from clang.cindex import Config, Index, CursorKind, TokenKind, Diagnostic

class CheckIndent(object):
    # pylint: disable=R0902
    def __init__(self, filename, includes, use_tab, tab_length, syntax_errror):
        # config
        self.debug = False
        self.tab_length = tab_length
        self.use_tab = use_tab
        self.filename = filename
        self.syntax_error = syntax_errror
        self.includes = includes

        # save notes
        self.notes = []

        # read file content
        for enc in ['utf8', 'latin-1']:
            try:
                with open(filename, encoding=enc) as f:
                    self.line_texts = [txt.rstrip('\r\n') for txt in f]
                self.line_texts.insert(0, '') # make indices correpond to real lines numbers
                break
            except:
                pass

        # clang parsing
        self.index = Index.create()
        args = ['-nostdinc'] + ['-I{}'.format(i) for i in self.includes]
        self.tu = self.index.parse(self.filename, args)
        self.parse_ok = True
        for d in self.tu.diagnostics:
            self.parse_ok = self.add_clang_diag(d) and self.parse_ok
        if not self.tu:
            raise Exception("Erro ao realizar parsing")

        # caches of token at each given location
        self.tok_levels = {}
        self.tokens = {}
        self.cursor_info = {}


    @staticmethod
    def make_loc(tok):
        return (tok.location.file.name, tok.location.line, tok.location.column)

    def set_debug(self, debug):
        self.debug = debug

    @staticmethod
    def make_location(from_loc, to_loc=None, add_len=0):
        if to_loc is None:
            to_loc = from_loc
        if from_loc.file.name != to_loc.file.name:
            to_loc = from_loc
        return {
            'file': from_loc.file.name,
            'position': [
                [from_loc.line, from_loc.column],
                [to_loc.line, to_loc.column + add_len]
            ]
        }

    @staticmethod
    def make_location_from_tok(from_tok, to_tok=None):
        add_len = 0
        if to_tok is None:
            to_tok = from_tok
        return CheckIndent.make_location(from_tok.location, to_tok.location, add_len)

    def add_clang_diag(self, diagnostic: Diagnostic):
        # collects info
        s = diagnostic.severity
        if s == Diagnostic.Ignored:
            severity = 'info'
        elif s == Diagnostic.Note:
            severity = 'info'
        elif s == Diagnostic.Warning:
            severity = 'warning'
        else:
            severity = 'error'
        cat_number = diagnostic.category_number
        excerpt = "{} ({})".format(diagnostic.category_name, str(cat_number))

        # ignore include errors
        # if cat_number == 1 and desc.find('file not found'):
        #     return True

        # adds note
        if self.syntax_error:
            self.add_note(
                location=self.make_location(diagnostic.location),
                excerpt=excerpt,
                description=diagnostic.spelling,
                severity=severity)

        # ok if non-fatal
        return s != Diagnostic.Fatal


    def add_note(self, location, excerpt, description=None, severity='warning'):
        if description is None:
            description = ''
        self.notes.append({
            'severity': severity,
            'location': location,
            'excerpt': excerpt,
            'description': description
        })


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
        return tab_level, space_level, space_in_a_row


    def detect_indent_type(self):
        tab_lines = space_lines = 0
        for text in self.line_texts:
            t, s, _ = self._get_line_indent_level(text)
            if t > s:
                tab_lines += 1
            elif t < s:
                space_lines += 1
        self.use_tab = tab_lines > space_lines


    def get_line_indent_level(self, text):
        tab_level, space_level, remaining_spaces = self._get_line_indent_level(text)
        return tab_level + space_level, remaining_spaces


    def _dump_ast(self, cursor, level):
        if cursor.location.file is not None and \
                cursor.location.file.name == self.filename:
            print(' '*level, cursor.kind, cursor.spelling)
        for c in cursor.get_children():
            self._dump_ast(c, level + 1)


    def dump_ast(self):
        self._dump_ast(self.tu.cursor, 0)


    def update_toks_level(self, toks, info, block_level):
        """
        stores the deepest block_level associated with the location of
        a token, and cursor info associated with the reason of the level
        """
        for t in toks:
            if t.location.file.name != self.filename:
                continue
            loc = self.make_loc(t)
            self.tokens.setdefault(loc, t)
            self.cursor_info[loc] = info
            self.tok_levels[loc] = block_level

    def visit(self, cursor, n_child, parent, p_toks, block_level):
        kind = cursor.kind
        p_kind = parent.kind if parent else None
        toks = list(cursor.get_tokens())

        # nested condition without {
        cond = [CursorKind.IF_STMT,
                CursorKind.WHILE_STMT,
                CursorKind.FOR_STMT,
                CursorKind.DO_STMT,
                CursorKind.SWITCH_STMT]

        # in statements like  if () {} else **if** () {}
        # we should not indent the **if** (this must be the third child of parent "if")
        if kind == CursorKind.IF_STMT and p_kind == CursorKind.IF_STMT and n_child == 3:
            # we decrease block_level here, since it will
            # be increased when visiting children below
            block_level -= 1

        # for other nested conditions, warns that they should probabily be using braces
        elif kind in cond and p_kind in cond:
            location = self.make_location_from_tok(p_toks[0], toks[0])
            desc = 'Você está colocando um comando {1} como bloco de outro comando {0}. ' + \
                   'Use {0} (...) {{ {1} (...) ... }} para ficar mais claro.'
            desc = desc.format(p_toks[0].spelling, toks[0].spelling)
            self.add_note(location, 'Condições aninhadas', desc)

        # first check for empty statements
        if kind == CursorKind.NULL_STMT:
            location = self.make_location_from_tok(p_toks[0], toks[0])
            command = p_toks[0].spelling
            if command != '{': # if the NULL_STMT is not an empty block like "{ }"
                desc = 'Note que o comando "{}" não executa NENHUM subcomando depois do ";"'
                desc = desc.format(command)
                self.add_note(location, 'Bloco vazio', desc)
            block_level += 1
            self.update_toks_level(toks, {'cursor': cursor, 'n_child': n_child}, block_level)

        # a brace always increments the level
        elif kind == CursorKind.COMPOUND_STMT:
            block_level += 1
            # but not of the levels of toks { and }
            self.update_toks_level(toks[1:-1], {'cursor': cursor, 'n_child': n_child}, block_level)

        # if this is a case statment, we should decrese
        # the indentation of the first token,
        elif kind == CursorKind.CASE_STMT:
            self.update_toks_level(toks[0:1], {'cursor': cursor, 'n_child': n_child}, block_level - 1)
            # updates the cursor corresponding to remaining tokens (the level does not change)
            self.update_toks_level(toks[1:], {'cursor': cursor, 'n_child': n_child}, block_level)

        # declarations like "unsigned int var1, var2, ..."
        elif kind == CursorKind.DECL_STMT:
            # does not indent, but store info
            self.update_toks_level(toks, {'cursor': cursor}, block_level)

        # other cases for indentation
        elif p_kind in [CursorKind.IF_STMT,
                        CursorKind.WHILE_STMT,
                        CursorKind.FOR_STMT,
                        CursorKind.DO_STMT,
                        CursorKind.SWITCH_STMT,
                        CursorKind.PAREN_EXPR,
                        CursorKind.INIT_LIST_EXPR,
                        CursorKind.FUNCTION_DECL,
                        CursorKind.STRUCT_DECL,
                        CursorKind.ENUM_DECL]:
            block_level += 1
            self.update_toks_level(toks, {'cursor': parent, 'n_child': n_child}, block_level)

        # visit recursively each children in order
        n = 1  # chiled num
        for c in cursor.get_children():
            self.visit(c, n, cursor, toks, block_level)
            n += 1

    # pylint: disable=R0914
    def check_tabs(self):
        # stores the first col which is a comment at each line
        first_col = [-1] * len(self.line_texts)

        def update_first_col(line, col):
            if first_col[line] == -1 or first_col[line] > col:
                first_col[line] = col

        for t in self.tu.cursor.get_tokens():
            # only cares about tokens in the current file
            if t.location.file.name != self.filename:
                continue
            # pylint: disable=E1101
            if t.kind == TokenKind.COMMENT:
                ls = t.extent.start.line
                cs = t.extent.start.column
                le = t.extent.end.line

                # update the line at which the token starts
                update_first_col(ls, cs)
                # update the other lines through  which the token spans
                for l in range(ls + 1, le + 1):
                    update_first_col(l, 1)

        # sets the config
        if self.use_tab:
            rexp = r'^(\t*)( +)'
            msg = 'Uso de espaço ao invés de tab'
        else:
            rexp = r'(^ *)(\t+)'
            msg = 'Uso de tab ao invés de espaço'
        for line, txt in enumerate(self.line_texts):
            m = re.match(rexp, txt)
            # if found offending whitespace
            if m:
                col = len(m.group(1)) + 1
                len_offending = len(m.group(2))
                # if the offending whitespace is not in a comment
                if first_col[line] == -1 or first_col[line] > col:
                    location = {
                        'file': self.filename,
                        'position': [[line, col], [line, col + len_offending]]
                    }
                    self.add_note(location, msg)

    def _get_diff_first_loc(self):
        # calculates the relative difference in indentation between two lines
        # we consider there a mistake has happen only if this difference is not assured
        difs = [0] * len(self.line_texts)
        first_locs = [None] * len(self.line_texts)
        last_lev = 0
        last_line = 0
        for loc, lev in sorted(self.tok_levels.items()):
            tok_file, tok_line, _ = loc
            if tok_file != self.filename:
                continue
            if tok_line == last_line:
                continue
            first_locs[tok_line] = loc
            difs[tok_line] = lev - last_lev
            last_lev = lev
            last_line = tok_line
            if self.debug:
                print("%2d:%2d   %d  %2d %10s |%s" %
                      (tok_line, loc[1], lev, difs[tok_line],
                       self.tokens[loc].spelling[:10], self.line_texts[tok_line]))
        return difs, first_locs

    # pylint: disable=R0914,R0915,R0912
    def check_indent(self):
        # first set level 0 to all tokens
        self.update_toks_level(self.tu.cursor.get_tokens(), {'cursor': self.tu.cursor, 'n_child': 1}, 0)

        self.visit(self.tu.cursor, 1, None, [], 0)

        difs, first_locs = self._get_diff_first_loc()

        # check indentation
        last_indent = 0  # indentation at last line
        last_reported = False  # keep track of last error (do not report consecutive indentation errors)
        for line, txt in enumerate(self.line_texts):
            if txt.strip() == '':
                continue

            indent, remaining_spaces = self.get_line_indent_level(txt)
            suggested = last_indent + difs[line]
            report_error = suggested != indent or remaining_spaces > 0

            # for is like an if, but we can break
            run_list = ['once'] if report_error else []
            for _ in run_list:
                loc = first_locs[line]

                # if loc is None, and this line is not empty,
                # then there is the continuation of a comment in here
                if loc is None:
                    report_error = False
                    break

                tok = self.tokens[loc]
                info = self.cursor_info[loc]

                # if this is a "case" of a SWITCH_STMT,
                # we allow indenting or not indenting the "case" keyword
                # pylint: disable=E1101
                if tok and tok.kind == TokenKind.KEYWORD and \
                        tok.spelling == 'case' and \
                        indent == suggested + 1:
                    indent = suggested
                    report_error = False
                    break

                # when indentation is larger than suggested, then ignore in some cases
                if indent > suggested or remaining_spaces > 0:
                    ok = False
                    k = info['cursor'].kind if tok else None
                    if not tok: # is a comment
                        ok = True
                    elif k in [CursorKind.IF_STMT, CursorKind.WHILE_STMT, CursorKind.SWITCH_STMT]:
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
                        ok = True
                    if ok:
                        indent = suggested
                        report_error = False
                        break

                # if reported error for last token, then ignore
                if last_reported:
                    indent = suggested
                    report_error = False
                    break

                location = {
                    'file': self.filename,
                    'position': [
                        [line, 1],
                        [line, tok.location.column]
                    ]
                }
                if remaining_spaces > 0:
                    desc = 'Remova {} espaços dessa linha'.format(remaining_spaces)
                    self.add_note(location, 'Espaços a mais', desc)

                if indent != suggested:
                    desc = 'Está indentado em %d níveis, mas era melhor com %d níveis. Corrija todo o bloco que segue!' % (indent, suggested)
                    self.add_note(location, 'Indentaçãoo errada', desc)
                report_error = True

            last_reported = report_error
            last_indent = indent


    def print_notes(self, context):
        'print notes and corresponding lines and context lines before'

        # hack to make integer mutable
        m_last_line = [-1]

        def print_note(note):
            if note['location']['file'] != self.filename:
                print(note)
                return
            start, end = note['location']['position']
            start_col = start[1]
            end_col = end[1]
            line = end[0]
            if start[0] != line:
                start_col = 0
            text = self.line_texts[line]
            start_col += text[:start_col].count('\t')*(self.tab_length-1)
            end_col += text[:end_col].count('\t')*(self.tab_length-1)
            for i in range(max(1, line - context, m_last_line[0]), line + 1):
                text = self.line_texts[i].replace('\t', '-' * (self.tab_length-1) + '>')
                print('{:2}: {}'.format(i, text))
            m_last_line[0] = line
            s = ' ' * (start_col + 3)
            s += '-' * (end_col - start_col - 1)
            s += '^ ' + note['excerpt']
            print(s)
            print('   ', note['description'])
            print()

        for n in self.notes:
            print_note(n)

    def sort_notes(self):
        self.notes = sorted(self.notes, key=lambda n: n['location']['position'][0])


def main():
    parser = argparse.ArgumentParser(description='Verifica indentação')

    parser.add_argument('-t', dest='use_tabs', action='store_true', help='Indentação com tabs')
    parser.add_argument('-s', dest='use_spaces', action='store_true', help='Indentação com espaços')
    parser.add_argument('-c', dest='syntax_errror', action='store_true', help='Mostra erros de sintaxe do clang')
    parser.add_argument('filename', metavar='arquivo.c', help='Nome do arquivo .c ou .h')
    parser.add_argument('-l', dest='tab_length', type=int, default=4, help='Tamanho da tabulação (padrão 4)')
    parser.add_argument('-j', dest='json_output', action='store_true', help='Saída em formato json para linter do atom')
    parser.add_argument('-d', dest='debug', action='store_true', help='Debug')
    parser.add_argument('-I', dest='includes', nargs='+', default=['/usr/include/', '/usr/include/x86_64-linux-gnu/', '/usr/include/clang/5.0/include/'], help='Include dirs')
    parser.add_argument('-O', dest='sharedobj', default='/usr/lib/x86_64-linux-gnu/libclang-5.0.so.1', help='Caminho para biblioteca clang')

    args = parser.parse_args()

    Config.set_library_file(args.sharedobj)

    if args.tab_length < 1 or args.tab_length > 16:
        print("Tamanho da tabulação inválida")
        return

    if args.use_tabs and args.use_spaces:
        print("Utilize -s ou -t; não ambos")
        return

    checker = CheckIndent(args.filename, args.includes, args.use_tabs, args.tab_length, args.syntax_errror)
    checker.set_debug(args.debug)
    if not args.use_tabs and not args.use_spaces:
        checker.detect_indent_type()
        kind = 'tabs' if checker.use_tab else 'espaços'
        if not args.json_output:
            print("Indentação detectada como usando", kind, "\n")
    if args.debug:
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
