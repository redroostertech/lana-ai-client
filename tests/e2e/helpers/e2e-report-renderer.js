/**
 * E2E Report Renderer — lana-client
 *
 * Generates a beautiful HTML report from test phase results.
 * Follows the same pattern as LANA-AI/tests/e2e/helpers/non-chat-e2e-report-helper.js
 *
 * @module tests/e2e/helpers/e2e-report-renderer
 */

'use strict';

var fs = require('fs');
var path = require('path');

function esc(str) {
  if (!str) return '';
  return String(str)
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;');
}

function renderReport(config) {
  var phases = config.phases || [];
  var totalPass = 0, totalFail = 0, totalSkip = 0, totalTime = 0;

  for (var i = 0; i < phases.length; i++) {
    for (var j = 0; j < phases[i].steps.length; j++) {
      var st = phases[i].steps[j];
      if (st.status === 'pass') totalPass++;
      else if (st.status === 'skipped') totalSkip++;
      else totalFail++;
      totalTime += st.duration || 0;
    }
  }

  var gradient = config.gradient || 'linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%)';
  var html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
  html += '<title>' + esc(config.title) + '</title><style>';
  html += [
    '*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}',
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f8fafc;color:#1e293b;line-height:1.6}',
    '.hdr{background:' + gradient + ';color:#fff;padding:32px 40px}',
    '.hdr h1{font-size:24px;font-weight:700}.hdr .sub{opacity:.85;font-size:14px;margin-top:4px}',
    '.stats{display:flex;gap:12px;margin-top:16px;flex-wrap:wrap}',
    '.stat{background:rgba(255,255,255,.15);border-radius:8px;padding:6px 14px;font-size:13px;font-weight:600}',
    '.stat.g{background:rgba(34,197,94,.25)}.stat.r{background:rgba(239,68,68,.25)}.stat.b{background:rgba(96,165,250,.2)}',
    '.wrap{max-width:1140px;margin:0 auto;padding:24px}',
    '.phase{background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);margin-bottom:24px;overflow:hidden}',
    '.ph-hdr{padding:16px 20px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;gap:12px}',
    '.ph-hdr h2{font-size:17px;font-weight:600;flex:1}',
    '.ph-badge{font-size:11px;font-weight:700;padding:3px 10px;border-radius:100px}',
    '.ph-badge.g{background:#dcfce7;color:#166534}.ph-badge.r{background:#fee2e2;color:#991b1b}',
    '.step{border:1px solid #e2e8f0;border-radius:10px;margin:10px 20px;overflow:hidden}',
    '.st-top{padding:12px 16px;display:flex;align-items:center;gap:12px}',
    '.st-top.pass{background:#f0fdf4;border-left:4px solid #22c55e}',
    '.st-top.fail{background:#fef2f2;border-left:4px solid #ef4444}',
    '.st-top.skipped{background:#f8fafc;border-left:4px solid #cbd5e1}',
    '.st-name{font-size:14px;font-weight:600;flex:1}',
    '.st-time{font-size:11px;color:#94a3b8}',
    '.st-badge{font-size:10px;font-weight:700;padding:2px 8px;border-radius:100px}',
    '.st-badge.pass{background:#dcfce7;color:#166534}.st-badge.fail{background:#fee2e2;color:#991b1b}',
    '.st-detail{padding:10px 16px;border-top:1px solid #e2e8f0;background:#fafbfc;font-size:12px;color:#475569}',
    'pre{background:#1e293b;color:#e2e8f0;padding:12px;border-radius:8px;font-size:12px;overflow-x:auto;white-space:pre-wrap;word-break:break-all;margin-top:8px}',
  ].join('\n');
  html += '</style></head><body>';

  html += '<div class="hdr"><h1>' + esc(config.title) + '</h1>';
  html += '<p class="sub">' + esc(config.subtitle || '') + ' — ' + new Date().toISOString() + '</p>';
  html += '<div class="stats">';
  html += '<div class="stat g">' + totalPass + ' Passed</div>';
  if (totalFail > 0) html += '<div class="stat r">' + totalFail + ' Failed</div>';
  html += '<div class="stat b">' + (totalPass + totalFail + totalSkip) + ' Total</div>';
  html += '<div class="stat">' + (totalTime / 1000).toFixed(1) + 's</div>';
  html += '</div></div><div class="wrap">';

  for (var pi = 0; pi < phases.length; pi++) {
    var ph = phases[pi];
    var phPass = 0, phFail = 0;
    for (var si = 0; si < ph.steps.length; si++) {
      if (ph.steps[si].status === 'pass') phPass++;
      else phFail++;
    }
    var phStatus = phFail > 0 ? 'r' : 'g';

    html += '<div class="phase"><div class="ph-hdr"><h2>Phase ' + (pi + 1) + ': ' + esc(ph.name) + '</h2>';
    html += '<span class="ph-badge ' + phStatus + '">' + phPass + '/' + ph.steps.length + '</span></div>';

    for (var si2 = 0; si2 < ph.steps.length; si2++) {
      var step = ph.steps[si2];
      var cls = step.status || 'fail';
      html += '<div class="step"><div class="st-top ' + cls + '">';
      html += '<span class="st-badge ' + cls + '">' + cls.toUpperCase() + '</span>';
      html += '<span class="st-name">' + esc(step.name) + '</span>';
      if (step.duration) html += '<span class="st-time">' + step.duration + 'ms</span>';
      html += '</div>';
      if (step.detail || step.error) {
        html += '<div class="st-detail">';
        if (step.detail) html += '<p>' + esc(step.detail) + '</p>';
        if (step.error) html += '<pre>' + esc(step.error) + '</pre>';
        html += '</div>';
      }
      html += '</div>';
    }

    html += '</div>';
  }

  html += '</div></body></html>';
  return html;
}

function writeReport(config, outputPath) {
  var html = renderReport(config);
  var dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, html, 'utf-8');
  return outputPath;
}

module.exports = { renderReport, writeReport };
