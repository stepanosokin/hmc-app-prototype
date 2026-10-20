# Разработческие проверки T8

Все попытки используют отдельные проекты; отчёты архивированы перед retirement.
Неуспешные попытки не являются финальными доказательствами acceptance.

1. `hmc-publication-t8-boundary-red`: ожидаемый red, gateway возвращал 404
   вместо 401 при отсутствии ключа. Закреплённый контейнер, native exit 1.
2. `hmc-publication-t8-dev1`: mypy обнаружил обращение к optional JSON без
   проверки None в новом тесте. Исправлено явным assert; native exit 1.
3. `hmc-publication-t8-dev2`: реальный GRIB, публикация и санитарная ошибка GIS
   прошли; acceptance обнаружил разные encoded/decoded run в ссылках
   capabilities. Исправлено построением ссылки через общий `links(manifest)`;
   native exit 1.
4. `hmc-publication-t8-dev3`: ключи, профили, ротация, отзыв, хешированное
   хранение, тёплый кеш и реальная edge-изоляция прошли. Runner ошибочно
   трактовал массив Docker inspect в Windows PowerShell как один объект и
   объявлял публикацию backend-порта. Исправлено разворачивание массива перед
   pipeline и null-aware подсчёт свойств; native exit 1.

Review дополнительно выявил unset POSTGRES_USER в upgrade-команде. Исправлены
fallback и проверка команды на заполненной базе. Это изменение выполнено до
финального freeze. Хронология продолжена в validation.md и retirement.json.
