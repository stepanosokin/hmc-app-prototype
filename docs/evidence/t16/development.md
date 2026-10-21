# Development T16

Все попытки используют реальный приватный ICON-EU T_G и изолированные Compose
проекты. Их имена указаны в `copy-verification.json` каждой попытки.

| Попытка | Результат и объяснение | Очистка |
| --- | --- | --- |
| [dev1](attempts/dev1/reports/browser/browser.json) | `Runtime.evaluate` timeout: неподдерживаемая настройка Fetch в worker оставила его приостановленным. Это не ошибка карты | [retirement](attempts/dev1/retirement.json), 0 ресурсов |
| [dev2](attempts/dev2/reports/browser/browser.json) | Навигация T14 прошла; итоговый gate отклонён: worker не поддерживает `Fetch.enable` (`-32601`). Его запрос уже перехвачен корневой страницей, что видно в журнале | [retirement](attempts/dev2/retirement.json), 0 ресурсов |
| [dev3](attempts/dev3/reports/browser/browser.json) | Удалены worker Fetch/autoattach; фактический перехват страницы, worker и nested worker подтверждён тремя URL. T14 и GPU unavailable прошли | [retirement](attempts/dev3/retirement.json), 0 ресурсов |
| [updates-dev1](attempts/updates-dev1/reports/browser/browser.json) | T15 updates/failure прошёл в offline-режиме; raw GRIB/PROJ, EDR/WMS: 6387 GPU samples, ≤0,001739026 K, mask differences 0 | [retirement](attempts/updates-dev1/retirement.json), 0 ресурсов |
| [android-final1](attempts/android-final1/reports/browser/browser.json) | Pointerdown/up пришли в правильный SUMMARY, но Chrome не сформировал ожидаемый click; gate остановлен, не засчитан | [retirement](attempts/android-final1/retirement.json), 0 ресурсов |
| [android-repeat1](attempts/android-repeat1/reports/browser/browser.json) | Неизменный полный повтор прошёл: три проекции, canonical point, palette reuse, missing time, drag/pinch и T15; все 181 inputs start/end совпали | [retirement](attempts/android-repeat1/retirement.json), 0 ресурсов |
| [desktop-final1](attempts/desktop-final1/reports/browser-edge/browser.json) | Все Chrome/Edge functional/network/numerical checks прошли; общий gate отклонён из-за гонки taskkill при очистке отдельной GPU-unavailable попытки. Полный suite не выполнялся | [retirement](attempts/desktop-final1/retirement.json), 0 ресурсов; [browser inventory](checks/desktop1-cleanup-audit.json) тоже 0 |

Для каждой попытки дополнены отсутствовавшие в report-only архиве source/runtime
inputs: все 181 файла сверены по размеру и SHA256 с исходным стартовым снимком.
Первичные retirement indexes и receipts сохранены без изменений. Секреты
Compose `.env` и ADB-ключи не включались в распространяемый архив.

Документационная попытка 1 завершилась до проверки ссылок: native `powershell
-File` передал список путей как одно имя с запятой. Повтор с настоящим массивом
путей прошёл. [Запись отказа](checks/documentation-attempt1.json) указывает,
что ресурсов не создавалось. Это не ошибка Markdown-ссылок.

Финальные проверки выполняются после review на неизменных входах; эти
Development-результаты отдельно не устанавливают выполнение M4.

Для Android input failure точный красный сигнал — ожидание настоящего
`click` после pointerup, а не неверное значение поля или координат. Отдельная
[проба](checks/touch-diagnostic.json) на том же физическом устройстве доставила
48/48 click (24 ручных touch streams, 24 tap gestures), затем исходный полный
сценарий прошёл на неизменных входах. Причина единичного пропуска внутри
Chrome не установлена; приложение/драйвер для этого не изменялись, неудачная
попытка сохранена и не выдана за успешную. При повторении нужно исследовать
Chrome input/compositor trace; геометрию и числовые допуски не ослабляли.

Гонка desktop cleanup объяснена независимо: taskkill сообщил об уже
завершившемся дочернем процессе, фактический остаток — 0. После исправления
ветки cleanup отдельная реальная
[Edge/profile проба](checks/cleanup-development.json) прошла. Её страница —
явная заглушка, она проверяет только освобождение браузера/профиля и не
заменяет real-source GPU gate. Полный desktop gate повторяется.
