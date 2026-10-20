import cProfile
import pstats
import time
from publication.domain import database, resolve
from publication import native_display
with database() as cursor:
    cursor.execute('SELECT revision FROM app.revisions LIMIT 1')
    revision = cursor.fetchone()['revision']
from publication.revisions import load_revision, batch_key
with database() as cursor:
    cursor.execute('SELECT manifest_path,manifest_sha256 FROM app.revisions WHERE revision=%s',(revision,))
    row=cursor.fetchone()
entry=load_revision(row['manifest_path'],row['manifest_sha256'])['batches'][0]
selection=revision+'.'+entry['key']
def run():
    for i in range(18):
        manifest=resolve(selection)
        root,item=native_display.source(manifest)
        native_display.render(root,item,i%6,i//6)
profile=cProfile.Profile()
profile.runcall(run)
pstats.Stats(profile).strip_dirs().sort_stats('cumtime').print_stats(30)
