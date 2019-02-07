var gm = require('gm');
var path = require('path');
var fs = require('fs');

function pathWithSuffix(inpath, suffix) {
  return path.join(
    path.dirname(inpath),
    path.basename(inpath, '.jpg') + suffix + '.jpg'
  );
}

function makeCropped(inpath, outpath, width, height, x, y) {
  return new Promise((resolve, reject) => {
    gm(inpath)
      .crop(width, height, x, y)
      .write(outpath, function(err) {
        if (err) return reject(new Error('makeCropped' + outpath + err));
        resolve();
      });
  });
}

function removeFile(inpath) {
  return new Promise((resolve, reject) =>
    fs.unlink(inpath, err => (err ? reject(err) : resolve()))
  );
}

function copyFile(inpath, outpath) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(outpath);
    out.on('close', resolve);
    out.on('error', reject);
    fs.createReadStream(inpath).pipe(out);
  });
}

function makeTiles(inpath, outpath, inwidth, inheight, n) {
  let promises = [];

  for (var row = 0; row < n; row++) {
    for (var col = 0; col < n; col++) {
      const tileoutpath = pathWithSuffix(outpath, `[${row}-${col}]`);
      promises.push(
        // crop tile for row and column
        makeCropped(
          inpath,
          tileoutpath,
          inwidth / n,
          inheight / n,
          inwidth / n * col,
          inheight / n * row
        ).then(() => {
          console.log('done', tileoutpath);
        })
      );
    }
  }

  return Promise.all(promises);
}

async function processImage(imagepath) {
  const outpath = path.resolve('./assets/bg/tile.png');

  console.log('outputting to', outpath);

  await makeTiles(imagepath, outpath, 2000, 1580, 5);
}

processImage('./src/assets/bg.png').catch(err => {
  console.error(err);
  process.exit(1);
});
