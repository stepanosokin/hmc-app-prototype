# Общий mypy вне Compose

Все запуски использовали одноразовый `docker run --rm --network none`,
read-only bind текущего workspace, workdir `/workspace`, image
`hmc-publication:t12`, entrypoint `mypy` и аргументы:

```text
--ignore-missing-imports --check-untyped-defs --cache-dir=/tmp/mypy decoder tests trials publication tools
```

1. Exit 1: `reference.py:72` — assignment float в переменную int;
   `reference.py:103` — Expected iterable as variadic argument. Переименованы
   дробные индексы; координатный список получил явный тип.
2. Exit 1: `reference.py:103` — No overload variant of transform matches list[float].
   Вызов заменён `transform(p[0],p[1])`.
3. Exit 0: `Success: no issues found in 54 source files`.
4. После добавления CPU/f32 эталона: exit 1, `reference.py:87/88` —
   Incompatible types in assignment (bytes вместо float);
   строки 89–92 — Value of type float is not indexable. Причина: повторное
   использование имён a/b для весов и байтов halo. Исправлено переименованием
   буферов в `left_payload`/`right_payload`. Числовые операции не менялись.
5. Exit 0: `Success: no issues found in 54 source files`.

После последнего исправления выбран новый Compose probe5; предыдущий probe4
остаётся отдельной development-попыткой с прежними точными входами.
Во всех пяти одноразовых запусках контейнер удалялся `--rm`; Compose-проекты,
тома и сети не создавались. Это компактная запись консольных диагностик сессии,
а не полный побайтовый stdout/stderr transcript. Полные журналы типов,
вызванных Compose runner, архивированы отдельно с каждым проектом.
