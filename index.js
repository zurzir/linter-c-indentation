'use babel'

l = console.log;

// import { CompositeDisposable } from 'atom';
const { execFileSync } = require('child_process');
// const {Point, Range} = require('atom')

export function activate() {
    // this.subscriptions = new CompositeDisposable();
    // this.subscriptions.add(atom.config.observe('linter-pylint.executablePath', (value) => {
    //   this.executablePath = value;
    // }));
    const packpath = atom.packages.getLoadedPackage('linter-simple-format').path;
    this.pyscript = [packpath, 'check_indent.py'].join('/');
}

export function provideLinter() {
    return {
        name: 'Indentação',
        scope: 'file',
        lintsOnChange: false,
        grammarScopes: ['source.c'],
        lint : async (editor) => {
            // const projectDir = getProjectDir(filePath);
            // const env = Object.create(process.env, {
            //   PYTHONPATH: {
            //     value: [
            //       process.env.PYTHONPATH,
            //       fixPathString(this.pythonPath, fileDir, projectDir),
            //     ].filter(x => !!x).join(delimiter),
            //     enumerable: true,
            //   },
            // });
            // const execOpts = { env, cwd, stream: 'both' };
            // if (this.disableTimeout) {
            //   execOpts.timeout = Infinity;
            // }
            const useTabs = !editor.usesSoftTabs();
            l('usetabs', useTabs)
            const tabLength = editor.getTabLength()
            const filePath = editor.getPath();
            const args = [this.pyscript, '-j', useTabs ? '-t' : '-s',
                          '-l', tabLength.toString(),filePath];
            var out;
            try {
                out = execFileSync('python3', args);
            } catch (err) {
                // atom.notifications.addError("Aconteceu algum erro");
                l("erro ao executar aquivo")
                l(err)
            }
            // for (n of notes) {
            //     arr = n['location']['position']
            //     n['location']['position'] = new Range(new Point(arr[0][0]-1, arr[0][1]-1) , new Point(arr[1][0]-1, arr[1][1]-1))
            // }
            try {
                notes = JSON.parse(out)
            } catch(err) {
                l("erro ao analisar json")
                l(err)
            }
            l("ok");
            return notes;
        },
    };
}
