"""Operator batch: direct children only, explicit config, per-file diagnostics."""
import argparse
import json
import uuid
from pathlib import Path

from decoder.grib_crs import configuration
from decoder.storage import bounded_frames, field_metadata
from decoder.inspect_forecast import SAMPLE_SHA256
from decoder.sampling import file_hash
from publication import recovery, worker
from publication.domain import database


def discover(directory: Path) -> list[Path]:
    result = []
    for path in sorted(directory.iterdir()):
        if not path.is_file() or path.is_symlink():
            continue
        with path.open('rb') as stream:
            header = stream.read(8)
        if header[:4] == b'GRIB':
            # Include other editions/truncated indicators for an explicit error.
            result.append(path)
    return result


def ingest(clock: str, report_path: Path, all_fields: bool = False,
           names: list[str] | None = None, stop_on_error: bool = False, hmc_refresh: bool = False) -> dict:
    # Fail the WHOLE batch before queue mutations when configuration is invalid.
    config = configuration()
    files = discover(Path('/input'))
    if names is not None:
        selected = {path.name: path for path in files}
        if len(names) != len(set(names)) or any(name not in selected for name in names):
            raise ValueError('Выбранный GRIB отсутствует или не является обычным прямым файлом')
        files = [selected[name] for name in names]
    report: dict = {'scope':'direct GRIB2 children only; no subdirectories or proj.txt',
              'configuration':config,'files':[],'state':'passed'}
    for index, path in enumerate(files, 1):
        print(json.dumps({'hmc_progress': 'Загрузка GRIB', 'done': index-1, 'total': len(files)}), flush=True)
        entry: dict = {'source':path.name}
        report['files'].append(entry)
        try:
            if path.stat().st_size>recovery.source_limit({'source_profile':'grib2-fields' if all_fields else 'surface-temperature-grib2'}):
                raise ValueError('GRIB2 превышает лимит размера исходного файла')
            frames = list(bounded_frames(path))
            if not 1<=len(frames)<=4096:
                raise ValueError('GRIB2 должен содержать от 1 до 4096 сообщений')
            metadata = [field_metadata(frame,index,config,sample_inventory=False,all_fields=all_fields) for index,frame in enumerate(frames,1)]
            if len({(m['model'],m['reference_time']) for m in metadata})!=1:
                raise ValueError('Один исходный файл должен содержать один расчёт модели')
            if len({(m.get('field','T_G:surface:0'),m['valid_time']) for m in metadata})!=len(metadata):
                raise ValueError('Повторяется поле и срок в одном исходном файле')
            specs = [m['source_crs'] for m in metadata]
            del frames
            checksum = file_hash(path)
            request: dict = {'hours':list(range(1,len(metadata)+1)),'fixture':'actual','recoverable':True,
                       'source_profile':'grib2-fields' if all_fields else 'surface-temperature-grib2',
                       'rebuild':True,'batch':uuid.uuid4().hex,'crs_configuration':config}
            if hmc_refresh:
                request['hmc_refresh'] = True
            if checksum==SAMPLE_SHA256:
                request['model']='ICON-EU'
            job = recovery.submit(clock,request,path.name,checksum,0)
            entry.update(job=job,sha256=checksum,source_crs_ids=sorted({s['id'] for s in specs}))
            worker.once(job)
            with database() as cursor:
                cursor.execute('SELECT state,selection,error FROM app.jobs WHERE id=%s',(job,))
                result = cursor.fetchone()
            entry.update(result)
            if result['state'] != 'published':
                raise RuntimeError('Задание не завершило публикацию всех сроков')
            final_revision=result['selection'].split('.',1)[0]
            with database() as cursor:
                cursor.execute("UPDATE app.retention_roots SET expired_at=clock_timestamp(),delete_after=NULL,"
                    "reason='batch-intermediate' WHERE root IN (SELECT revision FROM app.revisions "
                    "WHERE job_id=%s AND revision<>%s)", (job,final_revision))
            entry['revision']=final_revision
        except Exception as error:
            entry.update(state='failed',error_type=type(error).__name__,error=str(error))
            report['state']='failed'
        report_path.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
        print(json.dumps(entry,ensure_ascii=False),flush=True)
        print(json.dumps({'hmc_progress': 'Загрузка GRIB', 'done': index, 'total': len(files)}), flush=True)
        if report['state'] != 'passed' and stop_on_error:
            break
    if not files and names is None:
        report.update(state='failed',error='В исходной папке нет файлов GRIB2')
    report_path.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
    if report['state'] != 'passed':
        raise SystemExit(1)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--clock', required=True)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--all-fields', action='store_true')
    parser.add_argument('--source-name', action='append')
    args = parser.parse_args()
    ingest(args.clock, args.report, args.all_fields, args.source_name)


if __name__=='__main__':main()
