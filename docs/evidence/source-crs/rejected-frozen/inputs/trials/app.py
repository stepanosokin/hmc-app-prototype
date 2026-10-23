"""Real HTTP trial adapters; no production application is installed here."""

import json
import hashlib

from flask import Flask, Response, g, jsonify, request

from trials.service import COLLECTION, NATIVE_CRS, Catalog, QueryError, coverage, select
from trials.metrics import snapshot


def create_app(candidate: str) -> Flask:
    app = Flask(candidate)
    catalog = Catalog()
    if candidate == 'pygeoapi':
        from pygeoapi.api import API, APIRequest, describe_collections
        from pygeoapi.api.environmental_data_retrieval import get_collection_edr_query
    api = API({'server': {'url': 'http://gateway/pygeoapi/ogc', 'languages': ['en-US']},
               'logging': {'level': 'ERROR'}, 'resources': {
                   COLLECTION: {'type': 'collection', 'title': 'Ground surface temperature', 'keywords': ['temperature'],
                                'description': 'Native-sphere test-manifest position trial',
                                'extents': {'spatial': {'bbox': [-23.53125, 29.46875, 62.53125, 70.53125], 'crs': NATIVE_CRS}},
                                'providers': [{'type': 'edr', 'name': 'trials.provider.ManifestEDRProvider',
                                               'data': '/fixtures/catalog.json',
                                               'storage_crs': NATIVE_CRS, 'crs': [NATIVE_CRS]}]}}}, {}) if candidate == 'pygeoapi' else None

    @app.errorhandler(QueryError)
    def query_error(error):
        return jsonify(code=error.code, description=error.detail), error.status

    def bind_generation():
        # Capture the generation of this selection, not a later probe.
        g.accepted_generation = hashlib.sha256(catalog.raw).hexdigest()

    @app.after_request
    def selection_generation(response):
        if hasattr(g, 'accepted_generation'):
            response.headers['X-Manifest-Generation'] = g.accepted_generation
        return response

    @app.get('/health')
    def health():
        return jsonify(status='ready', candidate=candidate, refresh_error=catalog.refresh_error)

    @app.get('/metrics')
    def metrics():
        return jsonify(snapshot())

    @app.get('/generation')
    def generation():
        catalog.refresh()
        return jsonify(generation=hashlib.sha256(catalog.raw).hexdigest(), refresh_error=catalog.refresh_error)

    @app.get('/api/v1/point')
    def point():
        selected = select(catalog, request.args, False)
        bind_generation()
        return jsonify(selected.sample())

    @app.get('/ogc/collections')
    @app.get(f'/ogc/collections/{COLLECTION}')
    def metadata():
        if set(request.args) != {'run', 'revision'} or any(len(request.args.getlist(key)) != 1 for key in request.args):
            raise QueryError(400, 'InvalidParameterValue', 'exact run/revision required')
        selected = catalog.metadata(request.args)
        bind_generation()
        if api is not None:
            headers, status, body = describe_collections(api, APIRequest.from_flask(request, api.locales), COLLECTION)
            if status != 200:
                return Response(body, status=status, headers=headers)
            collection = json.loads(body)
        else:
            collection = {'id': COLLECTION, 'title': 'Ground surface temperature', 'data_queries': {'position': {}}}
        # The bounded trial advertises only the implemented profile. All links
        # preserve explicit run/revision; stock framework defaults do not.
        from urllib.parse import urlencode
        base = f'/{candidate}/ogc/collections/{COLLECTION}'
        suffix = '?' + urlencode({'run': selected['run'], 'revision': selected['revision']})
        collection['links'] = [{'rel': 'self', 'type': 'application/json', 'href': base + suffix}]
        collection['data_queries'] = {'position': {'link': {'href': base + '/position' + suffix,
                                                          'rel': 'data', 'type': 'application/vnd.cov+json'}}}
        collection['selection'] = selected
        collection['crs'] = [NATIVE_CRS]
        collection['storageCrs'] = NATIVE_CRS
        collection['extent'] = {
            'spatial': {'bbox': [[-23.53125, 29.46875, 62.53125, 70.53125]], 'crs': NATIVE_CRS},
            'temporal': {'interval': [[selected['valid_times'][0], selected['valid_times'][-1]]]}}
        if request.path.endswith('/' + COLLECTION):
            return jsonify(collection)
        return jsonify(collections=[collection], links=[])

    @app.get(f'/ogc/collections/{COLLECTION}/position')
    def position():
        g.selection = select(catalog, request.args, True)
        bind_generation()
        if api is None:
            return Response(app.json.dumps(coverage(g.selection)), content_type='application/vnd.cov+json')
        api_request = APIRequest.from_flask(request, api.locales)
        # Native CRS is explicitly handled above. No coordinate transformation
        # is requested from the framework's authority-URI-only CRS parser.
        api_request._args = request.args.copy()
        api_request._args.pop('crs', None)
        headers, status, body = get_collection_edr_query(api, api_request, COLLECTION, None, 'position')
        return Response(body, status=status, headers=headers)

    return app
