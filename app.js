// ============================================
// FOLDER COMPARISON APPLICATION
// Premium Enterprise File Diff Tool
// ============================================

console.log('DICOM Comparison App v3.0 Loaded - No Synthetic Data');

let globalComparisonData = null;
let currentFilter = 'all'; // 'all', 'removed', 'added', 'changed', 'unchanged'
const objectURLRegistry = new Set(); // Track object URLs for cleanup

// ============================================
// UTILITY FUNCTIONS
// ============================================

// Compute SHA-256 hash of file content
async function computeFileHash(file, isText) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    let data = arrayBuffer;

    if (isText) {
      // Normalize line endings for consistent comparison
      const text = new TextDecoder('utf-8').decode(arrayBuffer);
      const normalized = text.replace(/\r\n/g, '\n');
      data = new TextEncoder().encode(normalized);
    }

    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } catch (e) {
    console.error('Hash computation failed:', e);
    return null;
  }
}

// Track object URLs to prevent memory leaks
function createTrackedObjectURL(blob) {
  const url = URL.createObjectURL(blob);
  objectURLRegistry.add(url);
  return url;
}

// Cleanup all tracked object URLs
function cleanupObjectURLs() {
  objectURLRegistry.forEach(url => {
    try {
      URL.revokeObjectURL(url);
    } catch (e) {
      console.warn('Failed to revoke URL:', url);
    }
  });
  objectURLRegistry.clear();
}

// Compare folders and categorize files (Optimized O(n) with Map)
function compareFolders(sourceFolder, targetFolder) {
  if (!sourceFolder || !targetFolder) {
    console.warn('Invalid folder data for comparison');
    return { removed: [], added: [], changed: [], unchanged: [] };
  }

  // Build Maps for O(1) lookup instead of O(n) find
  const sourceMap = new Map((sourceFolder.files || []).map(f => [f.name, f]));
  const targetMap = new Map((targetFolder.files || []).map(f => [f.name, f]));

  const allFileNames = new Set([...sourceMap.keys(), ...targetMap.keys()]);

  const comparison = {
    removed: [],
    added: [],
    changed: [],
    unchanged: []
  };

  allFileNames.forEach(fileName => {
    const sourceFile = sourceMap.get(fileName);
    const targetFile = targetMap.get(fileName);

    if (sourceFile && !targetFile) {
      comparison.removed.push({ source: sourceFile, target: null, name: fileName });
    } else if (!sourceFile && targetFile) {
      comparison.added.push({ source: null, target: targetFile, name: fileName });
    } else if (sourceFile && targetFile) {
      // Use content hash if available, otherwise fallback to size/date
      let isDifferent;
      if (sourceFile.contentHash && targetFile.contentHash) {
        isDifferent = sourceFile.contentHash !== targetFile.contentHash;
      } else {
        // Fallback for server mode or files without hash
        isDifferent =
          sourceFile.size !== targetFile.size ||
          sourceFile.date !== targetFile.date ||
          (sourceFile.content !== undefined && targetFile.content !== undefined && sourceFile.content !== targetFile.content);
      }

      if (isDifferent) {
        comparison.changed.push({ source: sourceFile, target: targetFile, name: fileName });
      } else {
        comparison.unchanged.push({ source: sourceFile, target: targetFile, name: fileName });
      }
    }
  });

  return comparison;
}

// ============================================
// UI RENDERING
// ============================================

// Format file size
function formatSize(sizeMB) {
  if (sizeMB < 1) {
    return `${(sizeMB * 1024).toFixed(0)} KB`;
  }
  return `${sizeMB.toFixed(1)} MB`;
}

// Get file type icon
function getFileIcon(type) {
  const icons = {
    text: '📄',
    spreadsheet: '📊',
    pdf: '📕',
    image: '🖼️',
    dicom: '🩻',
    default: '📄'
  };
  return icons[type] || icons.default;
}

// Render folder information
function renderFolderInfo(folders) {
  const { sourceFolder, targetFolder } = folders;

  document.getElementById('left-folder-name').textContent = sourceFolder.name;
  document.getElementById('left-folder-size').textContent = formatSize(sourceFolder.totalSize);

  document.getElementById('right-folder-name').textContent = targetFolder.name;
  document.getElementById('right-folder-size').textContent = formatSize(targetFolder.totalSize);
}

// Set up upload listeners
function setupUploadHandlers(currentFolders) {
  const leftUpload = document.getElementById('upload-left');
  const rightUpload = document.getElementById('upload-right');

  leftUpload.addEventListener('change', (e) => handleUpload(e, 'left', currentFolders));
  rightUpload.addEventListener('change', (e) => handleUpload(e, 'right', currentFolders));
}

// Handle folder upload
async function handleUpload(event, side, folders) {
  const files = Array.from(event.target.files);
  if (files.length === 0) return;

  // Create folder object from uploaded files
  const folderName = files[0].webkitRelativePath.split('/')[0] || (side === 'left' ? 'Uploaded Source' : 'Uploaded Target');
  let totalSize = 0;

  // Create promises for file reading and hashing (fully async-safe)
  const filePromises = files.map(async (file) => {
    totalSize += file.size / (1024 * 1024); // Convert to MB
    const nameParts = file.name.split('.');
    const hasExtension = nameParts.length > 1;
    const extension = hasExtension ? nameParts.pop().toLowerCase() : '';
    const baseName = nameParts.join('.').toLowerCase();

    // Determine type
    let type = 'default';
    const textExtensions = ['txt', 'md', 'json', 'js', 'ts', 'tsx', 'jsx', 'html', 'css', 'py', 'java', 'c', 'cpp', 'h', 'xml', 'yaml', 'yml', 'sh', 'sql', 'env', 'gitignore', 'editorconfig', 'log', 'bat', 'ini', 'conf', 'cfg', 'properties', 'dockerfile', 'makefile'];
    const textBaseNames = ['readme', 'license', 'dockerfile', 'makefile', 'procfile', 'gemfile', 'package', 'composer'];

    if (textExtensions.includes(extension) || textBaseNames.includes(baseName) || (extension === '' && textBaseNames.includes(file.name.toLowerCase()))) {
      type = 'text';
    } else if (['xlsx', 'xls', 'csv'].includes(extension)) {
      type = 'spreadsheet';
    } else if (['pdf'].includes(extension)) {
      type = 'pdf';
    } else if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(extension)) {
      type = 'image';
    } else if (['dcm', 'dicom'].includes(extension)) {
      type = 'dicom';
    }

    const fileData = {
      name: file.name,
      size: file.size / (1024 * 1024),
      date: new Date(file.lastModified).toISOString().split('T')[0],
      type: type,
      content: '',
      file: file // Store the actual File object
    };

    // Read text content if needed
    if (type === 'text') {
      try {
        const text = await file.text();
        fileData.content = text;
      } catch (e) {
        console.warn('Failed to read text file:', file.name, e);
      }
    }

    // Compute content hash for all files (async-safe)
    const hash = await computeFileHash(file, type === 'text');
    if (hash) {
      fileData.contentHash = hash;
    }

    return fileData;
  });

  const parsedFiles = await Promise.all(filePromises);

  const newFolder = {
    name: folderName,
    totalSize: totalSize,
    files: parsedFiles
  };

  if (side === 'left') {
    folders.sourceFolder = newFolder;
  } else {
    folders.targetFolder = newFolder;
  }

  // Recalculate comparison
  const comparison = compareFolders(folders.sourceFolder, folders.targetFolder);
  globalComparisonData = comparison;
  currentFilter = 'all'; // Reset filter

  // Re-render UI
  renderFolderInfo(folders);
  renderSummary(comparison);
  renderFileList(comparison);

  // Reset summary item active states
  document.querySelectorAll('.summary-item').forEach(item => item.classList.remove('active'));
}

// Render summary statistics with animation
function renderSummary(comparison) {
  if (!comparison) {
    console.warn('Comparison data not ready');
    return;
  }

  const counts = {
    all: (comparison.removed?.length || 0) + (comparison.added?.length || 0) + (comparison.changed?.length || 0) + (comparison.unchanged?.length || 0),
    removed: comparison.removed?.length || 0,
    added: comparison.added?.length || 0,
    changed: comparison.changed?.length || 0,
    unchanged: comparison.unchanged?.length || 0
  };

  // Update badges in sidebar
  Object.keys(counts).forEach(key => {
    const badge = document.getElementById(`badge-${key}`);
    if (badge) animateCounter(badge, 0, counts[key], 1000);
  });
}

// Side-bar Filter Logic
function setupSidebarFilters() {
  const navItems = document.querySelectorAll('.nav-item');

  // "All Files" logic
  document.getElementById('nav-all').onclick = function () {
    currentFilter = 'all';
    updateActiveNavItem(this);
    renderFileList(globalComparisonData);
  };

  // Status-specific filters
  document.querySelectorAll('.status-filter').forEach(item => {
    item.onclick = function () {
      const status = this.getAttribute('data-status');
      toggleFilter(status, this);
    };
  });
}

function updateActiveNavItem(activeItem) {
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
  activeItem.classList.add('active');
}

function toggleFilter(status, element) {
  if (currentFilter === status) {
    currentFilter = 'all';
    updateActiveNavItem(document.getElementById('nav-all'));
  } else {
    currentFilter = status;
    updateActiveNavItem(element);
  }
  renderFileList(globalComparisonData);
}

// Animate counter from start to end
function animateCounter(element, start, end, duration) {
  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);

    // Easing function (ease-out)
    const easeOut = 1 - Math.pow(1 - progress, 3);
    const current = Math.floor(start + (end - start) * easeOut);

    element.textContent = current;

    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }

  requestAnimationFrame(update);
}

// Render file list
function renderFileList(comparison) {
  const fileList = document.getElementById('file-list');
  if (!fileList) return;

  fileList.innerHTML = '';

  if (!comparison) {
    console.warn('Comparison data not ready');
    return;
  }

  let allFiles = [
    ...(comparison.removed || []).map(f => ({ ...f, status: 'removed' })),
    ...(comparison.added || []).map(f => ({ ...f, status: 'added' })),
    ...(comparison.changed || []).map(f => ({ ...f, status: 'changed' })),
    ...(comparison.unchanged || []).map(f => ({ ...f, status: 'unchanged' }))
  ].sort((a, b) => a.name.localeCompare(b.name));

  // Apply filter
  if (currentFilter !== 'all') {
    allFiles = allFiles.filter(file => file.status === currentFilter);
  }

  if (allFiles.length === 0) {
    fileList.innerHTML = `
      <div style="padding: 2rem; text-align: center; color: var(--neutral-600);">
        No files match the current filter.
      </div>
    `;
    return;
  }

  allFiles.forEach(fileData => {
    const row = createFileRow(fileData);
    fileList.appendChild(row);
  });
}

// Create a file row element
function createFileRow(fileData) {
  const { source, target, name, status } = fileData;

  const row = document.createElement('div');
  row.className = `file-row ${status}`;

  // Left side (source)
  const leftItem = document.createElement('div');
  leftItem.className = 'file-cell';
  if (source) {
    const sizeChanged = status === 'changed' && target && source.size !== target.size;
    const dateChanged = status === 'changed' && target && source.date !== target.date;

    leftItem.innerHTML = `
      <div class="file-icon">${getFileIcon(source.type)}</div>
      <div class="file-info">
        <div class="file-name">${source.name}</div>
        <div class="file-details">
          <span class="${sizeChanged ? 'changed-meta' : ''}">${formatSize(source.size)}</span>
          <span class="${dateChanged ? 'changed-meta' : ''}">${source.date}</span>
        </div>
      </div>
    `;
    leftItem.appendChild(createViewButton(source, 'Source'));
  } else {
    leftItem.innerHTML = '<div class="file-name" style="opacity: 0.3; padding-left: 48px;">—</div>';
  }

  // Right side (target)
  const rightItem = document.createElement('div');
  rightItem.className = 'file-cell';
  if (target) {
    const sizeChanged = status === 'changed' && source && source.size !== target.size;
    const dateChanged = status === 'changed' && source && source.date !== target.date;

    rightItem.innerHTML = `
      <div class="file-icon">${getFileIcon(target.type)}</div>
      <div class="file-info">
        <div class="file-name">${target.name}</div>
        <div class="file-details">
          <span class="${sizeChanged ? 'changed-meta' : ''}">${formatSize(target.size)}</span>
          <span class="${dateChanged ? 'changed-meta' : ''}">${target.date}</span>
        </div>
      </div>
    `;
    rightItem.appendChild(createViewButton(target, 'Target'));
  } else {
    rightItem.innerHTML = '<div class="file-name" style="opacity: 0.3; padding-left: 48px;">—</div>';
  }

  row.appendChild(leftItem);
  row.appendChild(rightItem);

  // Add click handler
  row.addEventListener('click', (e) => {
    // If click was on a view button, don't open the diff
    if (e.target.closest('.btn-view')) return;
    prepareAndOpenDiff(fileData);
  });

  return row;
}

// Create a view button
function createViewButton(file, origin) {
  const btn = document.createElement('button');
  btn.className = 'btn-view';
  btn.innerHTML = 'View';
  btn.onclick = (e) => {
    e.stopPropagation();
    prepareAndOpenView(file, origin);
  };
  return btn;
}

// ============================================
// MODAL / DIFF VIEWER
// ============================================

// Open file diff modal
function openFileDiff(fileData) {
  if (!fileData) {
    console.warn('Invalid file data for diff');
    return;
  }

  const { source, target, name, status } = fileData;

  const modal = document.getElementById('modal-overlay');
  const modalTitle = document.getElementById('modal-title');
  const modalStatus = document.getElementById('modal-status');
  const modalIcon = document.getElementById('modal-file-icon');
  const modalBody = document.getElementById('modal-body');

  // Set modal header
  modalTitle.textContent = name;
  modalStatus.textContent = status;
  modalStatus.className = `modal-status ${status}`;

  const fileType = source?.type || target?.type;
  modalIcon.textContent = getFileIcon(fileType);

  // Render appropriate diff viewer
  modalBody.innerHTML = '';
  modalBody.classList.remove('hide-matched');
  const dToggle = document.getElementById('modal-diff-toggle');
  if (dToggle) dToggle.checked = false;

  // Show/Hide toggle based on purpose (Comparison vs View)
  const tContainer = document.getElementById('modal-diff-toggle-container');
  if (tContainer) tContainer.style.display = 'flex';

  const statusCapsule = `modal-status ${status}`;
  document.getElementById('modal-status').className = `status-capsule ${status}`;

  switch (fileType) {
    case 'text':
      modalBody.appendChild(createTextDiff(source, target, status));
      break;
    case 'spreadsheet':
      modalBody.appendChild(createSpreadsheetDiff(source, target, status));
      break;
    case 'pdf':
      modalBody.appendChild(createPdfDiff(source, target, status));
      break;
    case 'image':
      modalBody.appendChild(createImageDiff(source, target, status));
      break;
    case 'dicom':
      modalBody.appendChild(createDicomDiff(source, target, status));
      break;
    default:
      modalBody.appendChild(createUnsupportedDiff(source, target, status));
  }

  // Show modal
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

// Close modal
function closeModal() {
  const modal = document.getElementById('modal-overlay');
  modal.classList.add('hidden');
  document.body.style.overflow = '';

  // Cleanup object URLs to prevent memory leaks
  cleanupObjectURLs();
}

// Open single file view
async function openFileView(file, origin) {
  const modal = document.getElementById('modal-overlay');
  const modalTitle = document.getElementById('modal-title');
  const modalStatus = document.getElementById('modal-status');
  const modalIcon = document.getElementById('modal-file-icon');
  const modalBody = document.getElementById('modal-body');
  const toggleContainer = document.getElementById('modal-diff-toggle-container');

  // Set modal header
  modalTitle.textContent = `${file.name} (${origin})`;
  modalStatus.textContent = 'READY';
  modalStatus.className = 'status-capsule unchanged';
  modalIcon.textContent = getFileIcon(file.type);

  if (toggleContainer) toggleContainer.style.display = 'none';

  modalBody.innerHTML = '';
  modalBody.classList.remove('hide-matched');

  const container = document.createElement('div');
  container.className = 'text-diff';

  let contentHtml = '';
  switch (file.type) {
    case 'text':
      const lines = file.content.split('\n');
      contentHtml = `
        <div class="text-diff-container single-panel">
          <div class="diff-sub-panel">
            <div class="diff-sub-header">${origin} System Content</div>
            <div class="diff-content-scroll">
              ${lines.map((line, i) => `
                <div class="diff-line">
                  <div class="line-num">${i + 1}</div>
                  <div class="line-content">${escapeHtml(line)}</div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;
      break;

    case 'image':
      const imgSrc = file.file ? createTrackedObjectURL(file.file) : '';
      contentHtml = `
        <div class="text-diff-container single-panel">
          <div class="diff-sub-panel" style="align-items: center; justify-content: center; padding: 40px; overflow: auto;">
            ${(imgSrc || file.url) ? `<img src="${file.url || imgSrc}" style="max-width: 100%; max-height: 500px; border-radius: 8px; box-shadow: var(--shadow-md);" onload="${imgSrc ? 'URL.revokeObjectURL(this.src)' : ''}">` : '<div style="font-size: 8rem; margin-bottom: 24px;">🖼️</div>'}
            <h3 style="margin-top: 24px;">${file.name}</h3>
            <div class="image-metadata" style="margin-top: 24px; width: 100%; max-width: 400px;">
              <div class="metadata-row"><span>Dimensions:</span><strong>${file.width || 'Unknown'} × ${file.height || 'Unknown'}px</strong></div>
              <div class="metadata-row"><span>File Size:</span><strong>${formatSize(file.size)}</strong></div>
              <div class="metadata-row"><span>Last Modified:</span><strong>${file.date}</strong></div>
            </div>
          </div>
        </div>
      `;
      break;

    case 'spreadsheet':
      contentHtml = `
        <div class="spreadsheet-diff" style="max-width: 800px; margin: 0 auto;">
          <h3 style="margin-bottom: 20px; text-align: center;">Spreadsheet Data Preview</h3>
          <div style="padding: 2rem; text-align: center; color: var(--neutral-600);">
            No data available.
          </div>
        </div>
      `;
      break;

    case 'pdf':
      const pdfSrc = file.url || (file.file ? createTrackedObjectURL(file.file) : '');
      contentHtml = `
        <div class="pdf-diff" style="width: 100%; height: 100%; margin: 0 auto; display: flex; flex-direction: column;">
          <h3 style="margin-bottom: 16px; text-align: center;">PDF Document View</h3>
          <div class="pdf-preview" style="flex: 1; border: 1px solid var(--border-light); border-radius: 8px; overflow: hidden; background: #525659;">
            ${pdfSrc ?
          `<embed src="${pdfSrc}" type="application/pdf" width="100%" height="100%" />` :
          `<div class="pdf-icon">📕</div><h3>${file.name}</h3><p>Real PDF preview requires a file upload.</p>`
        }
          </div>
          <div style="margin-top: 16px; font-size: 0.875rem; color: var(--text-muted); text-align: center;">
            Size: ${formatSize(file.size)} | Modified: ${file.date}
          </div>
        </div>
      `;
      break;

    case 'dicom':
      const canvasId = `dicom-canvas-${Math.random().toString(36).substr(2, 9)}`;
      const tableBodyId = `dicom-table-body-${Math.random().toString(36).substr(2, 9)}`;

      contentHtml = `
        <div class="dicom-diff" style="max-width: 800px; margin: 0 auto; display: flex; flex-direction: column; gap: 24px;">
          <div style="display: flex; gap: 24px; background: var(--bg-app); border-radius: 12px; padding: 24px; border: 1px solid var(--border-light);">
            <div class="dicom-pixel-preview" style="width: 300px; height: 300px; position: relative;">
              <canvas id="${canvasId}" style="width: 100%; height: 100%; object-fit: contain; background: black;"></canvas>
              <div class="dicom-overlay-text" style="position: absolute; top: 10px; left: 10px; color: white; font-size: 10px; z-index: 10;">
                R<br>FOV: 250mm<br>THK: 1.0mm
              </div>
              <div class="dicom-overlay-text" style="position: absolute; bottom: 10px; left: 10px; color: white; font-size: 10px; z-index: 10;">
                KV: 120<br>MA: 200
              </div>
              <div class="dicom-overlay-text" style="position: absolute; top: 10px; right: 10px; color: white; font-size: 10px; z-index: 10; text-align: right;">
                HFS
              </div>
            </div>
            <div style="flex: 1; display: flex; flex-direction: column; justify-content: center;">
              <h3>Real DICOM Scan (${origin})</h3>
              <p style="color: var(--text-muted); font-size: 0.875rem;">Binary data parsed from <strong>${file.name}</strong></p>
              <div style="margin-top: 24px; display: flex; flex-wrap: wrap; gap: 8px;">
                <span class="badge badge-unchanged" style="padding: 4px 8px;">REAL PIXEL DATA</span>
                <span class="badge badge-changed" style="padding: 4px 8px;">16-BIT DEPTH</span>
              </div>
            </div>
          </div>
          <table class="diff-table" style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background: #f8fafc; border-bottom: 2px solid var(--border-light);">
                <th style="padding: 12px; text-align: left; width: 120px;">DICOM Tag</th>
                <th style="padding: 12px; text-align: left; width: 200px;">Attribute</th>
                <th style="padding: 12px; text-align: left;">Value</th>
              </tr>
            </thead>
            <tbody id="${tableBodyId}" style="font-size: 0.875rem;">
               <tr><td colspan="3" style="padding:20px; text-align:center;">Loading Metadata...</td></tr>
            </tbody>
          </table>
        </div>
      `;

      // Async loading of pixel data AND metadata
      (async () => {
        // 1. Pixel Data
        setTimeout(() => {
          const canvas = document.getElementById(canvasId);
          if (canvas && file.file) {
            parseDicomPixelData(file.file).then(pixelInfo => {
              if (pixelInfo) renderDicomToCanvas(canvas, pixelInfo);
            });
          }
        }, 0);

        // 2. Metadata
        let dicomMeta = null;
        if (file.file) {
          dicomMeta = await parseDicomMetadata(file.file);
        }
        // Fallback if still empty
        if (!dicomMeta) dicomMeta = { error: 'No Metadata Found' };

        const dicomTags = [
          { label: 'Patient Name', key: 'patientName', tag: '(0010,0010)' },
          { label: 'Patient ID', key: 'patientId', tag: '(0010,0020)' },
          { label: 'Study Date', key: 'studyDate', tag: '(0008,0020)' },
          { label: 'Modality', key: 'modality', tag: '(0008,0060)' },
          { label: 'Series Description', key: 'seriesDesc', tag: '(0008,103E)' }
        ];

        const tbody = document.getElementById(tableBodyId);
        if (tbody) {
          tbody.innerHTML = dicomTags.map(tag => `
                <tr style="border-bottom: 1px solid var(--border-light);">
                  <td style="padding: 12px; color: var(--text-light); font-family: var(--font-mono); font-size: 0.75rem;">${tag.tag}</td>
                  <td style="padding: 12px; font-weight: 500;">${tag.label}</td>
                  <td style="padding: 12px; color: var(--text-main);">${dicomMeta[tag.key] || '—'}</td>
                </tr>
             `).join('');
        }
      })();
      break;

    default:
      modalBody.appendChild(createUnsupportedSingleView(file, origin));
  }

  container.innerHTML = contentHtml;
  modalBody.appendChild(container);
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}


// Create text diff viewer showing ONLY changed lines
function createTextDiff(source, target, status) {
  const container = document.createElement('div');
  container.className = 'text-diff';

  if (status === 'removed') {
    return createSinglePanelDiff(source.content, 'Source (Removed)', 'removed', true);
  } else if (status === 'added') {
    return createSinglePanelDiff(target.content, 'Target (Added)', 'added', false);
  } else {
    // Both exist - show side by side changes only
    const sourceLines = source.content.split('\n');
    const targetLines = target.content.split('\n');
    const maxLines = Math.max(sourceLines.length, targetLines.length);

    // Identify changed line indices
    const changedIndices = [];
    for (let i = 0; i < maxLines; i++) {
      if (sourceLines[i] !== targetLines[i]) {
        changedIndices.push(i);
      }
    }

    // Group into chunks with 1 line context
    const chunks = [];
    if (changedIndices.length > 0) {
      let currentChunk = [changedIndices[0]];
      for (let i = 1; i < changedIndices.length; i++) {
        const diff = changedIndices[i] - changedIndices[i - 1];
        if (diff <= 3) { // Small gap, merge chunks
          for (let k = changedIndices[i - 1] + 1; k <= changedIndices[i]; k++) {
            currentChunk.push(k);
          }
        } else {
          chunks.push(currentChunk);
          currentChunk = [changedIndices[i]];
        }
      }
      chunks.push(currentChunk);
    }

    // Render chunks
    container.innerHTML = `
      <div class="text-diff-container">
        <div class="diff-sub-panel">
          <div class="diff-sub-header">SOURCE SYSTEM</div>
          <div class="diff-content-scroll" id="source-diff-content"></div>
        </div>
        <div class="diff-sub-panel">
          <div class="diff-sub-header">TARGET SYSTEM</div>
          <div class="diff-content-scroll" id="target-diff-content"></div>
        </div>
      </div>
    `;

    const sourceContent = container.querySelector('#source-diff-content');
    const targetContent = container.querySelector('#target-diff-content');

    if (chunks.length === 0) {
      const emptyMsg = '<p style="padding: 1rem; text-align: center; color: var(--neutral-600);">No text changes found.</p>';
      sourceContent.innerHTML = emptyMsg;
      targetContent.innerHTML = emptyMsg;
    } else {
      chunks.forEach((chunk, index) => {
        if (index > 0) {
          sourceContent.appendChild(createDivider());
          targetContent.appendChild(createDivider());
        }

        chunk.forEach(i => {
          const sLine = sourceLines[i] || '';
          const tLine = targetLines[i] || '';
          const isChanged = sLine !== tLine;

          sourceContent.appendChild(createDiffLine(i + 1, sLine, isChanged ? 'removed' : '', isChanged ? tLine : null));
          targetContent.appendChild(createDiffLine(i + 1, tLine, isChanged ? 'added' : '', isChanged ? sLine : null));
        });
      });
    }
  }

  return container;
}

// Helper: Create a single panel for added/removed files
function createSinglePanelDiff(content, header, status, isLeft) {
  const container = document.createElement('div');
  container.className = 'text-diff';

  const lines = content.split('\n');
  const panelHtml = `
    <div class="text-diff-container">
      <div class="diff-sub-panel">
        <div class="diff-sub-header">${header}</div>
        <div class="diff-content-scroll">
          ${lines.map((line, i) => `
            <div class="diff-line ${status}">
              <div class="line-num">${i + 1}</div>
              <div class="line-content">${escapeHtml(line)}</div>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="diff-sub-panel">
        <div class="diff-sub-header">${isLeft ? 'Target' : 'Source'} (Empty)</div>
        <div class="diff-content-scroll">
          <p style="padding: 24px; text-align: center; color: var(--text-light); font-family: sans-serif; font-size: 0.75rem;">
            File does not exist in this environment.
          </p>
        </div>
      </div>
    </div>
  `;
  container.innerHTML = panelHtml;
  return container;
}

// Helper: Create a line with line number and token-level highlighting
function createDiffLine(num, content, status, otherSideContent) {
  const wrapper = document.createElement('div');
  wrapper.className = `diff-line ${status} ${!status ? 'row-matched' : ''}`.trim();

  const lineNum = document.createElement('div');
  lineNum.className = 'line-num';
  lineNum.textContent = num;

  const lineContent = document.createElement('div');
  lineContent.className = 'line-content';

  if (status && otherSideContent !== null) {
    lineContent.innerHTML = highlightLineChanges(content, otherSideContent);
  } else {
    lineContent.textContent = content;
  }

  wrapper.appendChild(lineNum);
  wrapper.appendChild(lineContent);
  return wrapper;
}

// Tokenize and highlight differences between two strings
function highlightLineChanges(text, compareText) {
  // Regex to split by tabs or spaces while keeping the delimiters
  const tokens = text.split(/(\s+)/);
  const compareTokens = compareText.split(/(\s+)/);

  return tokens.map((token, i) => {
    const isDifferent = token !== compareTokens[i];
    const escaped = escapeHtml(token);
    return isDifferent ? `<mark class="diff-highlight">${escaped}</mark>` : escaped;
  }).join('');
}

// Helper: Create a chunk divider
function createDivider() {
  const div = document.createElement('div');
  div.className = 'diff-divider';
  div.textContent = '...';
  return div;
}

// Create spreadsheet diff viewer
function createSpreadsheetDiff(source, target, status) {
  const container = document.createElement('div');
  container.className = 'spreadsheet-diff';

  // Mock spreadsheet data
  // Synthetic data removed

  container.innerHTML = `
    <div style="padding: 2rem; text-align: center; color: var(--neutral-600);">
        Spreadsheet comparison not available.
    </div>
  `;

  return container;
}

// Create PDF diff viewer
function createPdfDiff(source, target, status) {
  const container = document.createElement('div');
  container.className = 'pdf-diff';

  let statusText = '';
  if (status === 'removed') statusText = 'This PDF was removed in the target folder';
  else if (status === 'added') statusText = 'This PDF was added in the target folder';
  else if (status === 'changed') statusText = 'PDF content or metadata has changed';
  else statusText = 'PDF files are identical';

  container.innerHTML = `
    <div class="pdf-preview">
      <div class="pdf-icon">📕</div>
      <h3>${statusText}</h3>
      <p style="color: var(--neutral-600); margin-top: var(--space-4);">
        Full PDF comparison requires specialized tools. 
        <br>Size difference: ${source ? formatSize(source.size) : 'Unknown'} → ${target ? formatSize(target.size) : 'Unknown'}
      </p>
    </div>
  `;

  return container;
}

// Create image diff viewer
function createImageDiff(source, target, status) {
  const container = document.createElement('div');
  container.className = 'image-diff';

  const sSrc = (source && source.url) || (source && source.file ? createTrackedObjectURL(source.file) : null);
  const tSrc = (target && target.url) || (target && target.file ? createTrackedObjectURL(target.file) : null);

  if (status === 'removed') {
    container.innerHTML = `
      <div class="image-panel">
        <h4>Source (Removed)</h4>
        <div style="background: var(--neutral-200); padding: var(--space-8); border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center;">
          ${sSrc ? `<img src="${sSrc}" style="max-width: 100%; max-height: 300px; border-radius: 4px;" onload="${(source && source.file) ? 'URL.revokeObjectURL(this.src)' : ''}">` : '<div style="font-size: 4rem;">🖼️</div>'}
        </div>
        <div class="image-metadata">
          <div class="metadata-row"><span>Dimensions:</span><strong>${source.width || 'N/A'} × ${source.height || 'N/A'}px</strong></div>
          <div class="metadata-row"><span>File Size:</span><strong>${formatSize(source.size)}</strong></div>
        </div>
      </div>
      <div class="image-panel">
        <h4>Target</h4>
        <div style="background: var(--neutral-200); padding: var(--space-8); border-radius: var(--radius-md); height: 100%; display: flex; align-items: center; justify-content: center;">
          <p style="color: var(--neutral-600);">Image does not exist</p>
        </div>
      </div>
    `;
  } else if (status === 'added') {
    container.innerHTML = `
      <div class="image-panel">
        <h4>Source</h4>
        <div style="background: var(--neutral-200); padding: var(--space-8); border-radius: var(--radius-md); height: 100%; display: flex; align-items: center; justify-content: center;">
          <p style="color: var(--neutral-600);">Image does not exist</p>
        </div>
      </div>
      <div class="image-panel">
        <h4>Target (Added)</h4>
        <div style="background: var(--neutral-200); padding: var(--space-8); border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center;">
          ${tSrc ? `<img src="${tSrc}" style="max-width: 100%; max-height: 300px; border-radius: 4px;" onload="${(target && target.file) ? 'URL.revokeObjectURL(this.src)' : ''}">` : '<div style="font-size: 4rem;">🖼️</div>'}
        </div>
        <div class="image-metadata">
          <div class="metadata-row"><span>Dimensions:</span><strong>${target.width || 'N/A'} × ${target.height || 'N/A'}px</strong></div>
          <div class="metadata-row"><span>File Size:</span><strong>${formatSize(target.size)}</strong></div>
        </div>
      </div>
    `;
  } else {
    container.innerHTML = `
      <div class="image-panel">
        <h4>Source</h4>
        <div style="background: var(--neutral-200); padding: var(--space-8); border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center;">
          ${sSrc ? `<img src="${sSrc}" style="max-width: 100%; max-height: 300px; border-radius: 4px;" onload="${(source && source.file) ? 'URL.revokeObjectURL(this.src)' : ''}">` : '<div style="font-size: 4rem;">🖼️</div>'}
        </div>
        <div class="image-metadata">
          <div class="metadata-row ${source.width === target.width && source.height === target.height ? 'row-matched' : ''}"><span>Dimensions:</span><strong>${source.width || 'N/A'} × ${source.height || 'N/A'}px</strong></div>
          <div class="metadata-row ${source.size === target.size ? 'row-matched' : ''}"><span>File Size:</span><strong>${formatSize(source.size)}</strong></div>
        </div>
      </div>
      <div class="image-panel">
        <h4>Target</h4>
        <div style="background: var(--neutral-200); padding: var(--space-8); border-radius: var(--radius-md); display: flex; align-items: center; justify-content: center;">
          ${tSrc ? `<img src="${tSrc}" style="max-width: 100%; max-height: 300px; border-radius: 4px;" onload="${(target && target.file) ? 'URL.revokeObjectURL(this.src)' : ''}">` : '<div style="font-size: 4rem;">🖼️</div>'}
        </div>
        <div class="image-metadata">
          <div class="metadata-row ${source.width === target.width && source.height === target.height ? 'row-matched' : ''}"><span>Dimensions:</span><strong>${target.width || 'N/A'} × ${target.height || 'N/A'}px</strong></div>
          <div class="metadata-row ${source.size === target.size ? 'row-matched' : ''}"><span>File Size:</span><strong>${formatSize(target.size)}</strong></div>
        </div>
      </div>
    `;
  }

  return container;
}

// Create DICOM diff viewer
function createDicomDiff(source, target, status) {
  const container = document.createElement('div');
  container.className = 'dicom-diff';

  const sCanvasId = `dicom-source-${Math.random().toString(36).substr(2, 9)}`;
  const tCanvasId = `dicom-target-${Math.random().toString(36).substr(2, 9)}`;
  const tableId = `dicom-table-${Math.random().toString(36).substr(2, 9)}`;

  container.innerHTML = `
    <div style="display: flex; gap: 24px; margin-bottom: 24px;">
      <div class="dicom-side-preview" style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 12px;">
        <h4 style="color: var(--text-light); font-size: 0.75rem;">SOURCE SCAN</h4>
        <div class="dicom-pixel-preview" style="width: 240px; height: 240px; position: relative;">
          <canvas id="${sCanvasId}" style="width: 100%; height: 100%; object-fit: contain; background: black;"></canvas>
          <div class="dicom-overlay-text" style="position: absolute; top: 8px; left: 8px; color: white; font-size: 10px; z-index: 10;">SOURCE</div>
        </div>
      </div>
      <div class="dicom-side-preview" style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 12px;">
        <h4 style="color: var(--text-light); font-size: 0.75rem;">TARGET SCAN</h4>
        <div class="dicom-pixel-preview" style="width: 240px; height: 240px; position: relative;">
          <canvas id="${tCanvasId}" style="width: 100%; height: 100%; object-fit: contain; background: black;"></canvas>
          <div class="dicom-overlay-text" style="position: absolute; top: 8px; left: 8px; color: white; font-size: 10px; z-index: 10;">TARGET</div>
        </div>
      </div>
    </div>
    
    <div style="background: var(--bg-app); border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px; border: 1px solid var(--border-light);">
      <h3>DICOM Medical Image Comparison</h3>
      <p style="color: var(--text-muted); font-size: 0.8125rem;">Technical metadata comparison of high-resolution pixel data.</p>
    </div>
    
    <table class="diff-table" id="${tableId}" style="width: 100%; border-collapse: collapse; font-size: 0.875rem;">
      <!-- Table content will be injected -->
      <thead>
        <tr style="background: #f8fafc; border-bottom: 2px solid var(--border-light);">
            <th style="padding: 12px; text-align: left; width: 120px;">DICOM Tag</th>
            <th style="padding: 12px; text-align: left; width: 200px;">Attribute Name</th>
            <th style="padding: 12px; text-align: left;">Source Value</th>
            <th style="padding: 12px; text-align: left;">Target Value</th>
            <th style="padding: 12px; text-align: left; width: 120px;">Status</th>
        </tr>
      </thead>
      <tbody>
        <tr><td colspan="5" style="padding: 20px; text-align: center; color: var(--text-muted);">Loading structure...</td></tr>
      </tbody>
    </table>
  `;

  // Define DICOM tag groups for better organization
  const dicomTagGroups = {
    patient: {
      patientName: 'Patient Name',
      patientId: 'Patient ID',
      patientSex: 'Patient Sex',
      patientBirthDate: 'Patient Birth Date'
    },
    study: {
      studyDate: 'Study Date',
      studyTime: 'Study Time',
      studyDescription: 'Study Description',
      accessionNumber: 'Accession Number'
    },
    series: {
      modality: 'Modality',
      seriesDesc: 'Series Description',
      protocolName: 'Protocol Name',
      seriesInstanceUID: 'Series Instance UID'
    },
    image: {
      instanceNumber: 'Instance Number',
      rows: 'Rows',
      cols: 'Columns',
      pixelSpacing: 'Pixel Spacing',
      sliceThickness: 'Slice Thickness'
    },
    acquisition: {
      manufacturer: 'Manufacturer',
      kvp: 'KVP'
    }
  };

  // Function to render table
  const renderTable = (sMeta, tMeta) => {
    const table = document.getElementById(tableId);
    if (!table) return;

    // Get all unique keys from both metadata objects
    const sKeys = sMeta ? Object.keys(sMeta) : [];
    const tKeys = tMeta ? Object.keys(tMeta) : [];
    const allTagKeys = Array.from(new Set([...sKeys, ...tKeys]));

    // Create a mapping of key to its group and label
    const keyToGroupAndLabel = {};
    Object.entries(dicomTagGroups).forEach(([group, tags]) => {
      Object.entries(tags).forEach(([key, label]) => {
        keyToGroupAndLabel[key] = { group, label };
      });
    });

    // For keys not in our predefined groups, create a default group
    allTagKeys.forEach(key => {
      if (!keyToGroupAndLabel[key]) {
        keyToGroupAndLabel[key] = { group: 'other', label: key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1') };
      }
    });

    const getLabel = (key) => keyToGroupAndLabel[key]?.label || key;
    const getTagCode = (key) => ({
      patientName: '(0010,0010)',
      patientId: '(0010,0020)',
      patientSex: '(0010,0040)',
      patientBirthDate: '(0010,0030)',
      studyDate: '(0008,0020)',
      studyTime: '(0008,0030)',
      studyDescription: '(0008,1030)',
      accessionNumber: '(0008,0050)',
      modality: '(0008,0060)',
      seriesDesc: '(0008,103E)',
      protocolName: '(0018,1030)',
      seriesInstanceUID: '(0020,000E)',
      instanceNumber: '(0020,0013)',
      rows: '(0028,0010)',
      cols: '(0028,0011)',
      pixelSpacing: '(0028,0030)',
      sliceThickness: '(0018,0050)',
      manufacturer: '(0008,0070)',
      kvp: '(0018,0060)'
    }[key] || '(????,????)');

    const tbody = table.querySelector('tbody');

    if (allTagKeys.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="padding: 20px; text-align: center; color: var(--text-muted);">No metadata available</td></tr>';
      return;
    }

    tbody.innerHTML = allTagKeys.map(key => {
      const sExists = sMeta && sMeta.hasOwnProperty(key);
      const tExists = tMeta && tMeta.hasOwnProperty(key);
      const sVal = sExists ? sMeta[key] : null;
      const tVal = tExists ? tMeta[key] : null;

      const isMatched = sExists && tExists && sVal === tVal;
      const isAdded = !sExists && tExists;
      const isRemoved = sExists && !tExists;
      const isModified = sExists && tExists && sVal !== tVal;

      let rowClass = isMatched ? 'row-matched' : '';
      if (isAdded) rowClass = 'diff-added';
      if (isRemoved) rowClass = 'diff-removed';
      if (isModified) rowClass = 'diff-changed';

      const statusLabel = isMatched ?
        '<span style="color: var(--neutral-600); font-weight: 600;">Identical</span>' :
        (isAdded ? '<span class="status-capsule added" style="font-size: 0.65rem;">Target Only</span>' :
          (isRemoved ? '<span class="status-capsule removed" style="font-size: 0.65rem;">Source Only</span>' :
            '<span class="status-capsule changed" style="font-size: 0.65rem;">Different</span>'));

      return `
            <tr class="${rowClass}" style="border-bottom: 1px solid var(--border-light); ${isModified ? 'background: #fffbeb;' : ''}">
                <td style="padding: 12px; color: var(--text-light); font-family: var(--font-mono); font-size: 0.75rem;">${getTagCode(key)}</td>
                <td style="padding: 12px; font-weight: 500;">${getLabel(key)}</td>
                <td style="padding: 12px; color: ${!sExists ? 'var(--text-muted)' : 'inherit'}">${sExists ? sVal : '—'}</td>
                <td style="padding: 12px; color: ${!tExists ? 'var(--text-muted)' : 'inherit'}">${tExists ? tVal : '—'}</td>
                <td style="padding: 12px;">${statusLabel}</td>
            </tr>
        `;
    }).join('');
  };

  // Async Data Loading
  (async () => {
    let sMeta = source?.metadata || {};
    let tMeta = target?.metadata || {};

    // If metadata is missing but file exists, parse it
    if ((!sMeta || Object.keys(sMeta).length === 0) && source?.file) {
      sMeta = await parseDicomMetadata(source.file) || {};
    }
    if ((!tMeta || Object.keys(tMeta).length === 0) && target?.file) {
      tMeta = await parseDicomMetadata(target.file) || {};
    }

    renderTable(sMeta, tMeta);

    // Pixel Rendering - only attempt if files exist
    if (source?.file) {
      const sCanvas = document.getElementById(sCanvasId);
      if (sCanvas) {
        // Set canvas dimensions
        sCanvas.width = 240;
        sCanvas.height = 240;

        parseDicomPixelData(source.file).then(pixelInfo => {
          if (pixelInfo) {
            renderDicomToCanvas(sCanvas, pixelInfo);
          } else {
            // If we can't render pixel data, show a placeholder
            const ctx = sCanvas.getContext('2d');
            ctx.fillStyle = '#333';
            ctx.fillRect(0, 0, sCanvas.width, sCanvas.height);
            ctx.fillStyle = 'white';
            ctx.font = '12px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('No Pixel Data', sCanvas.width / 2, sCanvas.height / 2);
          }
        });
      }
    }

    if (target?.file) {
      const tCanvas = document.getElementById(tCanvasId);
      if (tCanvas) {
        // Set canvas dimensions
        tCanvas.width = 240;
        tCanvas.height = 240;

        parseDicomPixelData(target.file).then(pixelInfo => {
          if (pixelInfo) {
            renderDicomToCanvas(tCanvas, pixelInfo);
          } else {
            // If we can't render pixel data, show a placeholder
            const ctx = tCanvas.getContext('2d');
            ctx.fillStyle = '#333';
            ctx.fillRect(0, 0, tCanvas.width, tCanvas.height);
            ctx.fillStyle = 'white';
            ctx.font = '12px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('No Pixel Data', tCanvas.width / 2, tCanvas.height / 2);
          }
        });
      }
    }
  })();

  return container;
}


/**
 * DICOM Binary Parsing Helpers
 */

async function parseDicomMetadata(file) {
  if (!file || !file.arrayBuffer) return null;

  try {
    const buffer = await file.arrayBuffer();
    const view = new DataView(buffer);

    if (buffer.byteLength < 132) return { error: 'File too short' };
    const magic = String.fromCharCode(view.getUint8(128), view.getUint8(129), view.getUint8(130), view.getUint8(131));
    if (magic !== 'DICM') return { error: 'Invalid DICOM header' };

    const metadata = {};
    const textDecoder = new TextDecoder('utf-8');
    let offset = 132;
    const limit = buffer.byteLength;

    while (offset < limit - 8) {
      const group = view.getUint16(offset, true);
      const element = view.getUint16(offset + 2, true);

      const vr1 = view.getUint8(offset + 4);
      const vr2 = view.getUint8(offset + 5);
      const isExplicitVR = (vr1 >= 65 && vr1 <= 90) && (vr2 >= 65 && vr2 <= 90);

      let length = 0;
      let valueOffset = 0;
      let nextOffset = 0;

      if (isExplicitVR) {
        const vrCode = String.fromCharCode(vr1, vr2);
        if (['OB', 'OW', 'OF', 'SQ', 'UT', 'UN'].includes(vrCode)) {
          length = view.getUint32(offset + 8, true);
          valueOffset = offset + 12;
          nextOffset = valueOffset + length;
        } else {
          length = view.getUint16(offset + 6, true);
          valueOffset = offset + 8;
          nextOffset = valueOffset + length;
        }
      } else {
        length = view.getUint32(offset + 4, true);
        valueOffset = offset + 8;
        nextOffset = valueOffset + length;
      }

      if (nextOffset > limit) break;

      const decodeStr = () => {
        return textDecoder.decode(buffer.slice(valueOffset, valueOffset + length)).replace(/\0/g, '').trim();
      };

      if (group === 0x0010 && element === 0x0010) {
        metadata.patientName = decodeStr();
      }
      else if (group === 0x0010 && element === 0x0020) {
        metadata.patientId = decodeStr();
      }
      else if (group === 0x0008 && element === 0x0020) {
        metadata.studyDate = decodeStr();
      }
      else if (group === 0x0008 && element === 0x0060) {
        metadata.modality = decodeStr();
      }
      else if (group === 0x0008 && element === 0x103E) {
        metadata.seriesDesc = decodeStr();
      }
      else if (group === 0x0020 && element === 0x0013) {
        metadata.instanceNumber = decodeStr();
      }
      else if (group === 0x0028 && element === 0x0010) {
        if (length === 2) metadata.rows = view.getUint16(valueOffset, true);
      }
      else if (group === 0x0028 && element === 0x0011) {
        if (length === 2) metadata.cols = view.getUint16(valueOffset, true);
      }

      offset = nextOffset;
    }

    return metadata;
  } catch (e) {
    console.error("DICOM Parsing Error", e);
    return { error: 'Parsing Exception' };
  }
}

async function parseDicomPixelData(file) {
  if (!file) return null;

  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);

  // Magic word check at offset 128
  if (buffer.byteLength < 132) return null;
  const magic = String.fromCharCode(view.getUint8(128), view.getUint8(129), view.getUint8(130), view.getUint8(131));
  if (magic !== 'DICM') return null;

  let offset = 132;
  let rows = 512, cols = 512;
  let pixelDataOffset = -1;
  let pixelDataLength = 0;

  // Re-use logic or simplistic scan for pixels
  // Simplified scan for key tags (compatible with old version but less robust than parseMetadata)
  while (offset < buffer.byteLength - 8) {
    const group = view.getUint16(offset, true);
    const element = view.getUint16(offset + 2, true);

    if (group === 0x0028 && element === 0x0010) { // Rows
      rows = view.getUint16(offset + 8, true);
      // This +8 assumption is only for Explicit VR US (Tag4+VR2+Len2=8). 
      // It's brittle but works for the generated file.
    } else if (group === 0x0028 && element === 0x0011) { // Cols
      cols = view.getUint16(offset + 8, true);
    } else if (group === 0x7FE0 && element === 0x0010) { // Pixel Data
      // Skip VR and Reserved bytes for OW/OB
      pixelDataLength = view.getUint32(offset + 8, true);
      pixelDataOffset = offset + 12;
      break;
    }
    offset += 2; // Naive skip
  }

  if (pixelDataOffset !== -1) {
    return {
      data: new Int16Array(buffer.slice(pixelDataOffset, pixelDataOffset + pixelDataLength)),
      rows, cols
    };
  }
  return null;
}

function renderDicomToCanvas(canvas, pixelInfo) {
  if (!canvas || !pixelInfo) return;
  const { data, rows, cols } = pixelInfo;
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d');
  const imageData = ctx.createImageData(cols, rows);

  let min = 32767, max = -32768;
  for (let i = 0; i < data.length; i++) {
    if (data[i] < min) min = data[i];
    if (data[i] > max) max = data[i];
  }

  const range = max - min || 1;
  const pixels = imageData.data;

  for (let i = 0; i < data.length; i++) {
    const val = ((data[i] - min) / range) * 255;
    const idx = i * 4;
    pixels[idx] = pixels[idx + 1] = pixels[idx + 2] = val;
    pixels[idx + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

// Create unsupported diff viewer
function createUnsupportedDiff(source, target, status) {
  const container = document.createElement('div');
  container.className = 'unsupported-diff';

  const ext = (source?.name || target?.name || '').split('.').pop();

  container.innerHTML = `
    <div style="text-align: center; padding: 48px; background: var(--bg-app); border-radius: 12px; border: 1px dashed var(--border-light);">
      <div style="font-size: 4rem; margin-bottom: 24px;">📦</div>
      <h3>Unsupported File Comparison</h3>
      <p style="color: var(--text-muted); margin-top: 8px; max-width: 500px; margin-inline: auto;">
        Direct preview is not optimized for <strong>.${ext}</strong> files. 
        Metadata validation and size comparison are shown below.
      </p>
      
      <div style="margin-top: 32px; display: flex; justify-content: center; gap: 16px;">
        <button class="btn-primary" id="btn-force-text" style="padding: 10px 20px; font-size: 0.875rem; background: var(--primary); color: white; border: none; border-radius: 6px; cursor: pointer;">
          Try Viewing as Text
        </button>
      </div>

      <div class="image-metadata" style="max-width: 500px; margin: 40px auto 0; text-align: left; background: white; padding: 20px; border-radius: 8px; border: 1px solid var(--border-light);">
        <div class="metadata-row"><span>Source Size:</span><strong>${source ? formatSize(source.size) : 'Unknown'}</strong></div>
        <div class="metadata-row"><span>Target Size:</span><strong>${target ? formatSize(target.size) : 'Unknown'}</strong></div>
        <div class="metadata-row"><span>Status:</span><strong style="text-transform: capitalize; color: var(--primary); text-align: right; flex: 1;">${status}</strong></div>
      </div>
    </div>
  `;

  const btn = container.querySelector('#btn-force-text');
  if (btn) btn.onclick = () => forceViewAsText(source, target, status);

  return container;
}

function createUnsupportedSingleView(file, origin) {
  const container = document.createElement('div');
  container.className = 'unsupported-view';

  container.innerHTML = `
    <div style="text-align: center; padding: 60px; background: var(--bg-app); border-radius: 12px; border: 1px solid var(--border-light);">
      <div style="font-size: 5rem; margin-bottom: 24px;">📂</div>
      <h3>Preview Not Available</h3>
      <p style="color: var(--text-muted); margin-top: 12px;">This file type does not support inline viewing by default.</p>
      
      <button class="btn-primary" id="btn-force-text-single" style="margin-top: 24px; padding: 10px 24px; background: var(--primary); color: white; border: none; border-radius: 6px; cursor: pointer;">
        Force View as Text
      </button>

      <div class="image-metadata" style="max-width: 400px; margin: 40px auto 0; text-align: left;">
        <div class="metadata-row"><span>File Name:</span><strong>${file.name}</strong></div>
        <div class="metadata-row"><span>System:</span><strong>${origin}</strong></div>
        <div class="metadata-row"><span>File Size:</span><strong>${formatSize(file.size)}</strong></div>
      </div>
    </div>
  `;

  const btn = container.querySelector('#btn-force-text-single');
  if (btn && file.file) {
    btn.onclick = () => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const tempFile = { ...file, content: e.target.result, type: 'text' };
        const modalBody = document.getElementById('modal-body');
        modalBody.innerHTML = '';
        modalBody.appendChild(createTextDiff(tempFile, null, 'unchanged'));
      };
      reader.readAsText(file.file);
    };
  }

  return container;
}

async function forceViewAsText(source, target, status) {
  const modalBody = document.getElementById('modal-body');
  modalBody.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: center; height: 200px; color: var(--text-muted);">
      <div class="spinner" style="border: 4px solid #f3f3f3; border-top: 4px solid var(--primary); border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite;"></div>
      <span style="margin-left: 16px;">Reading binary as text...</span>
    </div>
  `;

  const read = (f) => (f && f.file) ? new Promise(r => {
    const reader = new FileReader();
    reader.onload = (e) => r(e.target.result);
    reader.readAsText(f.file);
  }) : Promise.resolve('');

  const [sContent, tContent] = await Promise.all([read(source), read(target)]);

  const sCopy = source ? { ...source, content: sContent, type: 'text' } : null;
  const tCopy = target ? { ...target, content: tContent, type: 'text' } : null;

  modalBody.innerHTML = '';
  modalBody.appendChild(createTextDiff(sCopy, tCopy, status));
}

// Utility: Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// INITIALIZATION
// ============================================

function initializeApp() {
  // Initialize with empty folders
  const folders = {
    sourceFolder: {
      name: 'Source Folder',
      totalSize: 0,
      files: []
    },
    targetFolder: {
      name: 'Target Folder',
      totalSize: 0,
      files: []
    }
  };

  const comparison = compareFolders(folders.sourceFolder, folders.targetFolder);
  globalComparisonData = comparison;

  // Render UI
  renderFolderInfo(folders);
  renderSummary(comparison);
  renderFileList(comparison);
  setupSidebarFilters();

  // Set up upload handlers
  setupUploadHandlers(folders);

  // Set up modal close handlers
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') {
      closeModal();
    }
  });

  // Diff toggle event listener
  document.getElementById('modal-diff-toggle')?.addEventListener('change', (e) => {
    const modalBody = document.getElementById('modal-body');
    if (e.target.checked) {
      modalBody.classList.add('hide-matched');
    } else {
      modalBody.classList.remove('hide-matched');
    }
  });

  // Keyboard shortcut to close modal (ESC key)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
    }
  });

  // Check if running in server mode
  checkServerMode(folders);
}

// Check if data is available from server
async function checkServerMode(folders) {
  try {
    const response = await fetch('/api/comparison');
    if (response.ok) {
      const data = await response.json();
      console.log('📦 Server mode detected. Loading data...', data);

      // Map server data to app structure
      folders.sourceFolder = {
        ...data.source,
        files: data.source.files.map(f => ({ ...f, origin: 'source' }))
      };
      folders.targetFolder = {
        ...data.target,
        files: data.target.files.map(f => ({ ...f, origin: 'target' }))
      };

      // Refresh comparison
      const comparison = compareFolders(folders.sourceFolder, folders.targetFolder);
      globalComparisonData = comparison;

      renderFolderInfo(folders);
      renderSummary(comparison);
      renderFileList(comparison);

      // Hide uploaders or show connected status
      document.querySelectorAll('.upload-area').forEach(el => {
        el.innerHTML = '<div style="color: var(--success); font-weight: 500;">✓ Connected to Server</div>';
        el.style.padding = '1rem';
      });

    }
  } catch (e) {
    console.log('Running in standalone mode (no server API)');
  }
}

// Fetch file content if missing
async function ensureFileContent(file, origin) {
  if (file.content !== undefined && file.content !== '') return;
  if (!file.origin && !origin) return; // Local file without content?

  const side = (file.origin || origin).toLowerCase().includes('source') ? 'source' : 'target';
  const url = `/files/${side}/${encodeURIComponent(file.relativePath || file.name)}`;

  try {
    if (file.type === 'text') {
      const res = await fetch(url);
      if (res.ok) file.content = await res.text();
    } else if (file.type === 'image' || file.type === 'pdf') {
      // For binary files, we might just use the URL
      file.url = url;
    } else if (file.type === 'dicom') {
      const res = await fetch(url);
      if (res.ok) file.file = await res.blob(); // Convert to blob for parsing
    }
  } catch (e) {
    console.error('Failed to fetch file content', e);
  }
}

// Wrap open actions to ensure content
async function prepareAndOpenDiff(fileData) {
  const { source, target } = fileData;
  const promises = [];
  if (source) promises.push(ensureFileContent(source, 'source'));
  if (target) promises.push(ensureFileContent(target, 'target'));

  document.body.style.cursor = 'wait';
  await Promise.all(promises);
  document.body.style.cursor = 'default';

  openFileDiff(fileData);
}

async function prepareAndOpenView(file, origin) {
  document.body.style.cursor = 'wait';
  await ensureFileContent(file, origin);
  document.body.style.cursor = 'default';
  openFileView(file, origin);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}