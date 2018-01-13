# Linter para indentação


Procura erros de indentação comuns para programadores iniciantes
em linguagem C.

## Dependências

Instale ou o pacote  `atom-ide-ui` ou o pacote  `linter`.

## Observações do estilo verificado

*   palavras chaves ` case ` são alinhadas junto com o switch, como em:
    ```c
    switch (value) {
    case 1:
        printf("1\n");
        break;
    case 2:
    case 3:
        printf("2 ou 3\n");
        break;
    default:
        printf("padrão\n");
    }
    ```

*   os tokens abre-chaves aumentam o nível apenas do próximo token; apenas os níveis
    de indentação são verificados; é indiferente usar `{` e `}` no fim da linha, ou
    em linha separada; o seguinte código não contém erro de indentação:
    ```c
    int main()
    {
        if () {
            verdade();
        } else
        {
            falso();
        }
    }
    ```

*   embora convenientes, não são permitido statements vazios só com o `;`
    que podem ser confusos para iniciantes; o seginte código gera um aviso:
    ```c
    for (p = list; p->value != x ; p = p->prox);
    ```

*   condições aninhadas devem sempre ser envolvidas com chaves, independentemente
    da combinação dos commandos (`if`, `for`, `while`, `else`); o seguinte código
    irá gerar dois avisos sugerindo envolver o segundo comando `for` e o
    comando `if`
    ```c
    void bubblesort(int *v, int l, int r) {
        int i, j;
        for (i = l; i < r; i++)
            for (j = r; j > i; j--)
                if (v[j] < v[j-1])
                    troca(&v[j-1], &v[j]);
    }
    ```
    a única exceção é a sequeência `else if`, que é interpretada como se fosse um
     único token; a formatação sugerida é:
    ```c
    if (n % 4 == 0)
        printf("n é múltiplo de 4\n");
    else if (n % 3 == 0)
        printf("n é múltiplo de 3, mas não é de 4.\n");
    else
        printf("n não é múltiplo de 3 nem de 4.\n");
    ```



## Por que não usar o formatador automático?

Um programador iniciante em C ainda não tem claro o que significa
um bloco de comandos e não sabe quais blocos se referem a que condições ou escopo.
Por exemplo, um formatador iria gerar um código como
```c
if (condicao) ;
comando_se_verdade();
comando_seguinte();
```
Mas um aluno não iria entender porque ` comando_se_verdade() `
executa sempre, independentemente da condição. Assim é melhor mostrar os erros enquanto
ele está programando. Depois de algumas semanas, quando o aluno já estiver mais seguro, ele
poderá desabilitar esse linter,  adotar um estilo próprio e possivelmente
passar a utilizar um formatador de código.
