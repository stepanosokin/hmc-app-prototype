# Итоговая сверка спецификации общего WMS — №105

16.11.2026. [Спецификация №105](https://github.com/stepanosokin/hmc-app-prototype/issues/105)
«Единый многослойный WMS с русскими названиями» сверена по реализации
[№106](wms-106.md), [№107](wms-107.md), [№108](wms-108.md),
[№109](wms-109.md) и [итоговой приёмке №110](wms-110.md).
Все пять задач прочитаны в GitHub вместе с комментариями: CLOSED, по 8/8.
Начальный HEAD этой сверки: `06cafb068137a6f35ba5da455ca57d59dff6ee58`.

Это проверка уже полученных свидетельств и оформление закрытия родителя.
Новая реализация и `/implement` не потребовались; приложение и условия
продуктовой приёмки не меняются. Новый Docker/browser/QGIS-прогон не запускался.

## Действующий контракт

Учтено согласованное уточнение №105 при реализации №106 от 13.11.2026:
обе кнопки дают общий закреплённый URL `?snapshot=…`. Прежняя ссылка сохраняет
прогноз при обновлении и открытии проекта. Для свежего прогноза получают новую
ссылку, заменяют URL подключения и добавляют слои заново. Незакреплённый адрес
остаётся discovery. Первоначальное описание обновления читается с этим уточнением.

Штатное массовое добавление выполняется через QGIS «Браузер → Добавить выбранные
слои в проект». Потеря temporal metadata при массовом добавлении окном WMS
отдельно задокументирована; рабочий Browser-путь проверен без сборки URI.

## Сверка WMS-01–WMS-16

Основные свидетельства относительно `HMC_EVIDENCE_ROOT/wms110/`:
**S** — `service-final2-passed`; **B** — `service-final1-failed-full-suite`;
**N** — `observations-final`. В B используются только отдельные успешные
browser/copy-to-QGIS сценарии; общий gate final1 остаётся failed.

| Критерий | Подтверждённое поведение и первичные свидетельства |
| --- | --- |
| WMS-01 | Обе кнопки, точные модель/название, старый расчёт и единый snapshot URL: B/`catalogue-chrome-standard1/browser.json`, `catalogue-edge-standard1/browser.json`; именно скопированная ссылка в обычном QGIS: B/`copied-url-qgis/receipt.json`. |
| WMS-02 | Полный разрешённый каталог, 6 моделей/12 листьев, папки без Name: S/`common-catalogue.json`, `catalogue-dialog-tree.json`, `common-desktop.json`; assertions исходного HTTP-сценария сохранены в frozen inputs. |
| WMS-03 | Русские Title/Style/имя добавленного слоя, уровни и различающие варианты: S/`common-catalogue.json`, `common-desktop.json`, `catalogue-0.json`–`catalogue-3.json`. |
| WMS-04 | Скалярная скорость ветра, исключение U/V/направления, независимость от переключателей: S/`common-catalogue.json` и обе browser-матрицы B. |
| WMS-05 | Переименование, новый расчёт/редакция сохраняют Name; сетки различаются, накопления не дробятся по длительности: S/`common-catalogue.json`, `full-catalogue.stderr.log`, frozen `tests/test_common_wms_catalogue.py`; интервалы: `common-multilayer-values.json`. |
| WMS-06 | Поздняя коррекция старого расчёта, частичная публикация без смешивания: S/`common-updates-models.json`, `common-updates-desktop.json`. |
| WMS-07 | Атомарная редакция, независимые модели, допустимое состояние после отказа: S/`common-updates-models.json`, `common-updates-base.json`, `common-updates-desktop.json`. |
| WMS-08 | Новый каталог после публикации, согласованные ссылки и операции снимка: S/`common-updates-models.json`, `common-updates-desktop.json`, `common-multilayer-desktop.json`. |
| WMS-09 | Обычное добавление, redraw/reopen с прежними Map/Identify/Legend; новый URL даёт 290 K вместо 280 K: S/`updates-before.json`, `updates-redraw.json`, `updates-reopened.json`, `updates-refreshed.json`, `common-updates-desktop.json`. |
| WMS-10 | Штатные single/bulk, разные модели/сроки, temporal metadata: S/`common-multilayer-desktop.json`, 30 наблюдений; ограничение диалога записано в `multilayer-dialog-limitation.json`, Browser-путь подтверждён отдельно. |
| WMS-11 | Ранний default каждого слоя, точный общий TIME, атомарный отказ без nearest: S/`common-multilayer-values.json`, `common-multilayer-errors.json` и прошедший multilayer HTTP-сценарий. |
| WMS-12 | Map/Identify/Legend одного снимка, расчёт/редакция/срок/единицы/интервал: S/`common-wms-numerical.json`, `common-desktop.json`, `common-updates-desktop.json`, `common-multilayer-desktop.json`. |
| WMS-13 | Независимые нативные значения, NoData и точность 0.0001 K в обоих CRS, два срока, Identify 3201×1801: S/`t11-desktop.json`, `t11-cold-matrix.json` (48/48), `common-multilayer-nodata.json`, T5 на закреплённом GRIB. |
| WMS-14 | Снятие/истечение/GC без отката, 410 старой ссылки и новая редакция без её восстановления: S/`common-wms-lifecycle.json`, `common-updates-withdrawal.json`, `common-updates-desktop.json`. |
| WMS-15 | Public/org, отзыв, защищённые операции, ошибки, лимиты и очереди: S/`t8-access.json`, `common-multilayer-errors.json`, `t9-wms-queue.json`, `t9-wms-lifecycle.json`, `t9-wms-rate-bytes.json`; все соответствующие процессы имеют native exit 0. |
| WMS-16 | [Инструкция перехода](../qgis.md#краткая-инструкция-перехода-на-общий-wms), полный двухфазный T11/T5, архивы, review, cleanup и проверенный commit/push №110: S/`gate.json`, `process-results.jsonl`, N/`cleanup-final.json` и итоговые комментарии №110. |

## Проверки и границы

Повторно сверены все 11 архивов [индекса №110](wms-110.archives.json):
5836 файлов, полный состав, размеры и SHA256, включая индексы. Проверены
непосредственно JSON-результаты, процессные exit codes, полный suite 146 тестов
(56 ожидаемых skips), 48 cold cases, 30 многослойных наблюдений и обе целевые
browser-матрицы по 16 наблюдений. Map/Identify/Legend старого проекта совпадают
до/после открытия; новая ссылка меняет карту и значение.

Итоговый T11 был выполнен на неизменных входах с обычным QGIS 3.44.11-Solothurn.
Suite использовал baseline T5 до независимых fixtures. Применимые регрессии
доступа/бюджетов включены; отдельные полные T8/T9/T7 не требовались без изменения
соответствующих политик. Полный viewer/T16 и физический 4K не заявляются
проверенными. Failed final1/CDP остаются failed; reuse успешных браузеров
подтверждён в N/`browser-reuse-after-orchestration.json` и рассмотрен в review.
Для №106–№109 прочитаны компактные отчёты; повторная полная
проверка их исторического состава не выполнялась. Основание итоговой приёмки —
проверенный интегрированный набор №110.

Свидетельства cleanup подтверждают удаление обоих стендов №110 и 18 браузерных
попыток; QGIS пуст, временных подключений/namespace нет. Эта сверка новых
тестовых ресурсов не создаёт. Live, пользовательские проекты, исходники и
прежние архивы сохраняются. Самопроверка матрицы относительно действующего
текста №105: пропущенных критериев и обязательных непроведённых gate нет.

Итог: подтверждены **16/16** критериев, пробелов нет. Прежние записи об открытой
№105 в отчётах дочерних задач описывают состояние на момент их завершения.
Окончательные commit/push и CLOSED readback оформляются комментарием №105
после фиксации этой записи.

Материалы этой сверки: `HMC_EVIDENCE_ROOT/wms105/acceptance-audit-20261116`,
7 файлов, SHA256 `archive-index.json`:
`c75ecea897f22142f33f7f47c2c0cd0008695a10416c84f58eac8c0e0e8fd13b`.
Включены исходные тексты/состояния задач и комментарии, программа сверки,
полный результат проверки архивов, предложенный чеклист и pre-commit снимок
этого отчёта до добавления ссылки на архив. Состав, размеры и SHA256 нового
архива также проверены. Post-push/closed readback хранится отдельно в
`wms105/acceptance-completion-20261116`.
