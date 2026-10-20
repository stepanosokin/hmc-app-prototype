"""OpenAPI for the deployed bounded numerical surface; no conformance claim."""


def document(prefix: str) -> dict:
    def parameter(name, location='query', required=True, **schema):
        return {'name': name, 'in': location, 'required': required, 'schema': {'type': 'string', **schema}}

    error = {'type': 'object', 'required': ['code', 'description'],
             'properties': {'code': {'type': 'string'}, 'description': {'type': 'string'}}}

    def operation(summary, params=(), media='application/json'):
        return {'summary': summary, 'parameters': list(params),
            'responses': {'200': {'description': 'Успех', 'content': {media: {'schema': {'type': 'object'}}}},
                **{str(status): {'description': label, 'content': {'application/json': {'schema': error}}}
                   for status, label in [(400, 'Недопустимые параметры'), (401, 'Требуется ключ'),
                       (403, 'Нет доступа'), (404, 'Выборка недоступна'), (410, 'Срок хранения истёк'),
                       (413, 'Превышен размер ответа'), (429, 'Превышен бюджет'),
                       (503, 'Временная ошибка'), (504, 'Истекло время запроса')]}},
            'security': [{'bearerAuth': []}, {'apiKey': []}] if prefix == '/org' else []}

    selection = parameter('selection', 'path')
    point = [parameter(key) for key in ('selection', 'run', 'revision', 'valid_time', 'layer', 'lon', 'lat')]
    crs = parameter('crs', required=False, enum=['urn:hmc:crs:icon-sphere-6371229',
        'http://www.opengis.net/def/crs/OGC/1.3/CRS84'], default='urn:hmc:crs:icon-sphere-6371229')
    edr = [selection, *[parameter(key) for key in ('coords', 'datetime', 'parameter-name', 'run', 'revision')],
           crs, parameter('f', required=False, enum=['CoverageJSON', 'json'])]
    paths = {
        '/api/v1/catalogue': operation('Опубликованные выборки'),
        '/api/v1/modules': operation('Модули и возможности'),
        '/api/v1/models': operation('Доступные модели'),
        '/api/v1/runs': operation('Запуски модели', [parameter('model')]),
        '/api/v1/revisions': operation('Ревизии запуска', [parameter('model'), parameter('run')]),
        '/api/v1/point': operation('Точная выборка ближайшей native-ячейки', [*point, crs]),
        '/api/v1/selections/{selection}/tiles.json': operation('Числовой контракт тайлов v2', [selection]),
        '/ogc': operation('Описание профиля'),
        '/ogc/conformance': operation('Соответствие OGC не заявлено'),
        '/ogc/collections': operation('Коллекции опубликованных выборок'),
        '/ogc/collections/{selection}': operation('Доступные измерения коллекции', [selection]),
        '/ogc/collections/{selection}/position': operation('EDR Position, одна точка и одно время', edr, 'application/vnd.cov+json'),
    }
    return {'openapi': '3.0.3', 'info': {'title': 'Числовой API Гидрометцентра', 'version': '1.0.0',
        'description': 'Профиль hmc-edr-position/1. CRS по умолчанию: native-сфера; ответ всегда native. '
            'run/revision — обязательные расширения. Instances, bulk download и полное соответствие OGC не заявлены. '
            'Для организаций используйте сервер /org и ключ numeric/all. Публичное демо не принимает ключи.'},
        'servers': [{'url': prefix or '/'}], 'paths': {path: {'get': value} for path, value in paths.items()},
        'components': {'securitySchemes': {'bearerAuth': {'type': 'http', 'scheme': 'bearer'},
                                         'apiKey': {'type': 'apiKey', 'in': 'header', 'name': 'X-API-Key'}}}}
