"""Small wrapper around Piper's trainer (piper1-gpl) that fixes two problems found while testing it.

  python train_piper.py fit ...      same flags as `python -m piper.train fit`
  python train_piper.py export --checkpoint X.ckpt --output-file Y.onnx

1. Piper also keeps checkpoints by a downloaded quality predictor ("val_mos"); when that predictor can't be fetched,
   training crashes after the first epoch. Here checkpoints are kept by validation mel loss only.
2. Recent PyTorch exports ONNX with the new torch.export path by default, which fails on Piper's spline flow.
   Export uses the classic exporter (dynamo=False), which Piper's runtime has always used.
"""
import functools, sys

def fit():
    from lightning.pytorch.callbacks import ModelCheckpoint
    import piper.train.__main__ as piper_train
    piper_train._DEFAULT_CALLBACKS[:] = [ModelCheckpoint(monitor='val_mel', mode='min', save_top_k=3, save_last=True,
                                                         filename='epoch={epoch}-val_mel={val_mel:.4f}', auto_insert_metric_name=False)]
    sys.argv = ['piper.train'] + sys.argv[1:]
    piper_train.main()

def export():
    import torch
    torch.onnx.export = functools.partial(torch.onnx.export, dynamo=False)
    import piper.train.export_onnx as piper_export
    sys.argv = ['piper.train.export_onnx'] + sys.argv[2:]
    piper_export.main()

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'export': export()
    else: fit()
