# Linter para indentação


Procura erros de indentação comuns para programadores iniciantes
em linguagem C.

## Dependências

Instale ou o pacote  `atom-ide-ui` ou o pacote  `linter`.

## Observações do estilo verificado

* palavras chaves ` case ` são alinhadas junto com o switch:
```c
switch (value) {
case 1:
    printf("1\n");
    break;
case 2:
case 3:
    break;
default:
    printf("padrão\n");
}
```

* os tokens abre-chaves aumentam o nível apenas do próximo token; apenas os níveis
  de indentação são verificados; é indiferente usar `{` e `}` no fim da linha, ou
  em linha separada:
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

## Por que não usar o formatador automático?

Um programador iniciante em C ainda não tem claro o que significa
um bloco de comandos e não sabe quais blocos se referem a que condições ou escopo.
Por exemplo, um formatador iria gerar um código como:
```c
if (condicao) ;
comando_se_verdade();
comando_seguinte();
```
Mas um aluno poderia não entender porque ` comando_se_verdade() `
executa sempre. Assim é melhor mostrar os erros enquanto está programando.
Depois de algumas semanas, quando o aluno já estiver mais seguro, ele
poderá desabilitar esse linter,  adotar um estilo próprio e possivelmente
passar a utilizar um formatador de código.
