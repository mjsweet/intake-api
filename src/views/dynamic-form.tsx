import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import { renderMarkdown } from "../lib/markdown";
import type { Brand } from "../lib/brands";

interface FormField {
  id?: string;
  name?: string;
  label: string;
  type: "text" | "textarea" | "select" | "checkbox" | "content" | "file" | "image";
  value?: string;
  default?: string;
  placeholder?: string;
  required?: boolean;
  options?: string[];
  accept?: string;
  category?: string;
  fileIds?: string[];
  captions?: string[];
  annotatable?: boolean;
}

interface FormSection {
  heading?: string;
  title?: string;
  description?: string;
  fields: FormField[];
  repeatable?: boolean;
  repeatId?: string;
  min?: number;
  max?: number;
}

export interface FormDefinition {
  title: string;
  description?: string;
  sections: FormSection[];
}

interface DynamicFormPageProps {
  token: string;
  definition: FormDefinition;
  brand: Brand;
}

function fieldName(field: FormField): string {
  return field.name ?? field.id ?? "";
}

function fieldValue(field: FormField): string {
  return field.value ?? field.default ?? "";
}

function sectionHeading(section: FormSection): string {
  return section.heading ?? section.title ?? "";
}

function namespacedField(field: FormField, repeatId: string, index: number | string): FormField {
  const base = field.name || field.id || field.label.toLowerCase().replace(/\s+/g, "_");
  return { ...field, name: `${repeatId}[${index}].${base}` };
}

function renderFieldBlock(field: FormField, token: string) {
  return (
    <div>
      {field.type !== "content" && field.type !== "file" && field.type !== "image" && (
        <label class="block text-sm font-medium text-gray-700 mb-1">
          {field.label}
          {field.required && <span class="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      {field.type === "content" && (
        <label class="block text-sm font-medium text-gray-700 mb-2">
          {field.label}
        </label>
      )}
      {field.type === "file" && (
        <label class="block text-sm font-medium text-gray-700 mb-2">
          {field.label}
          {field.required && <span class="text-red-500 ml-0.5">*</span>}
        </label>
      )}
      {field.type === "image" && (
        <label class="block text-sm font-medium text-gray-700 mb-2">
          {field.label}
        </label>
      )}
      {renderField(field, token)}
    </div>
  );
}

function renderField(field: FormField, token: string) {
  const inputClasses =
    "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500";
  const name = fieldName(field);
  const value = fieldValue(field);

  switch (field.type) {
    case "text":
      return (
        <input
          type="text"
          name={name}
          required={field.required}
          value={value}
          placeholder={field.placeholder ?? ""}
          class={inputClasses}
        />
      );

    case "textarea":
      return (
        <textarea
          name={name}
          required={field.required}
          rows={4}
          placeholder={field.placeholder ?? ""}
          class={inputClasses}
        >
          {value}
        </textarea>
      );

    case "select":
      return (
        <select name={name} required={field.required} class={inputClasses}>
          <option value="">Select...</option>
          {(field.options ?? []).map((opt) => (
            <option value={opt} selected={value === opt}>
              {opt}
            </option>
          ))}
        </select>
      );

    case "checkbox":
      return (
        <div class="space-y-2">
          {(field.options ?? []).map((opt) => (
            <label class="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name={name}
                value={opt}
                class="rounded border-gray-300"
              />
              {opt}
            </label>
          ))}
        </div>
      );

    case "content":
      return (
        <div
          class="bg-gray-50 border border-gray-200 rounded-lg p-4 prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{
            __html: renderMarkdown(value),
          }}
        />
      );

    case "image": {
      const ids = field.fileIds ?? [];
      const caps = field.captions ?? [];
      return (
        <div class="space-y-4" data-image-field={name} data-annotatable={field.annotatable ? "true" : "false"}>
          {ids.map((fileId, idx) => (
            <div class="image-block" data-file-id={fileId} data-field-name={name}>
              <div class="relative inline-block w-full">
                <img
                  src={`/${token}/files/${fileId}`}
                  alt={caps[idx] || field.label}
                  loading="lazy"
                  class="w-full rounded-lg border border-gray-200"
                />
                {field.annotatable && (
                  <div class="annotation-layer" data-annotation-layer={`${name}__${fileId}`}></div>
                )}
              </div>
              {caps[idx] && (
                <p class="text-xs text-gray-500 mt-1">{caps[idx]}</p>
              )}
              {field.annotatable && (
                <div class="annotation-notes mt-2 space-y-2" data-annotation-notes={`${name}__${fileId}`}></div>
              )}
            </div>
          ))}
          {field.annotatable && ids.length > 0 && (
            <p class="text-xs text-gray-400">Click on the image to add annotation pins</p>
          )}
        </div>
      );
    }

    case "file": {
      const category = field.category ?? "photo";
      const accept = field.accept ?? "image/*";
      return (
        <div
          class="file-upload-zone border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-400 transition-colors cursor-pointer"
          data-field-id={name}
          data-token={token}
          data-category={category}
          data-accept={accept}
        >
          <input
            type="file"
            multiple
            accept={accept}
            class="hidden"
            data-upload-input={name}
          />
          <div class="text-gray-400 mb-2">
            <svg class="mx-auto h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <p class="text-sm font-medium text-gray-700">Click to upload or drag files here</p>
          <p class="text-xs text-gray-500 mt-1">Up to 500 MB per file</p>
          <div class="file-list mt-4 space-y-2" data-file-list={name}></div>
        </div>
      );
    }

    default:
      return null;
  }
}

export const DynamicFormPage: FC<DynamicFormPageProps> = ({
  token,
  definition,
  brand,
}) => {
  const hasFileFields = definition.sections.some((s) =>
    s.fields.some((f) => f.type === "file")
  );
  const hasImageFields = definition.sections.some((s) =>
    s.fields.some((f) => f.type === "image" && f.annotatable)
  );
  const hasRepeatableSections = definition.sections.some((s) => s.repeatable);

  return (
    <Layout title={`${definition.title} - ${brand.name}`} brand={brand}>
      <div class="mb-8">
        <h1 class="text-2xl font-bold text-gray-900 mb-2">
          {definition.title}
        </h1>
        {definition.description && (
          <p class="text-gray-600">{definition.description}</p>
        )}
      </div>

      <form id="dynamic-form" data-token={token} novalidate>
        {definition.sections.map((section, sectionIdx) => {
          const heading = sectionHeading(section);

          if (section.repeatable && section.repeatId) {
            const repeatId = section.repeatId;
            const min = section.min ?? 1;
            const max = section.max ?? 0;
            const initialCount = Math.max(min, 1);

            return (
              <div
                class={sectionIdx > 0 ? "mt-10 pt-8 border-t border-gray-200" : ""}
                data-repeat-id={repeatId}
                data-repeat-min={min}
                data-repeat-max={max}
              >
                <h2 class="text-xl font-bold text-gray-900 mb-1">{heading}</h2>
                {section.description && (
                  <p class="text-gray-500 text-sm mb-6">{section.description}</p>
                )}

                <div data-repeat-instances>
                  {Array.from({ length: initialCount }).map((_, idx) => (
                    <div
                      data-repeat-instance={idx}
                      class="repeat-instance border border-gray-200 rounded-lg p-5 mb-4 relative bg-white"
                    >
                      <div class="flex items-center justify-between mb-4">
                        <span class="text-sm font-medium text-gray-500">
                          {heading} <span data-repeat-num>{idx + 1}</span>
                        </span>
                        <button
                          type="button"
                          class="repeat-remove text-red-400 hover:text-red-600 text-xs font-medium"
                          data-repeat-remove
                        >
                          Remove
                        </button>
                      </div>
                      <div class="space-y-5">
                        {section.fields.map((field) =>
                          renderFieldBlock(namespacedField(field, repeatId, idx), token)
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Hidden template for cloning */}
                <template data-repeat-template>
                  <div
                    data-repeat-instance="__IDX__"
                    class="repeat-instance border border-gray-200 rounded-lg p-5 mb-4 relative bg-white"
                  >
                    <div class="flex items-center justify-between mb-4">
                      <span class="text-sm font-medium text-gray-500">
                        {heading} <span data-repeat-num>__NUM__</span>
                      </span>
                      <button
                        type="button"
                        class="repeat-remove text-red-400 hover:text-red-600 text-xs font-medium"
                        data-repeat-remove
                      >
                        Remove
                      </button>
                    </div>
                    <div class="space-y-5">
                      {section.fields.map((field) =>
                        renderFieldBlock(namespacedField(field, repeatId, "__IDX__"), token)
                      )}
                    </div>
                  </div>
                </template>

                <button
                  type="button"
                  class="repeat-add w-full border-2 border-dashed border-gray-300 rounded-lg py-3 text-sm font-medium text-gray-500 hover:border-blue-400 hover:text-blue-500 transition-colors"
                  data-repeat-add={repeatId}
                >
                  + Add another {heading.toLowerCase()}
                </button>
              </div>
            );
          }

          // Non-repeatable section (unchanged)
          return (
            <div
              class={sectionIdx > 0 ? "mt-10 pt-8 border-t border-gray-200" : ""}
            >
              <h2 class="text-xl font-bold text-gray-900 mb-1">{heading}</h2>
              {section.description && (
                <p class="text-gray-500 text-sm mb-6">{section.description}</p>
              )}
              <div class="space-y-5">
                {section.fields.map((field) => renderFieldBlock(field, token))}
              </div>
            </div>
          );
        })}

        <div class="mt-10 pt-6 border-t border-gray-200">
          <button
            type="submit"
            id="btn-submit"
            class="px-6 py-2.5 text-sm font-medium text-white rounded-lg hover:opacity-90 transition-opacity"
            style={`background-color: ${brand.primaryColour};`}
          >
            Submit
          </button>
        </div>
      </form>

      <script
        dangerouslySetInnerHTML={{
          __html: `
(function() {
  var form = document.getElementById('dynamic-form');
  var token = form.dataset.token;
  var storageKey = 'intake_' + token;
  var btnSubmit = document.getElementById('btn-submit');
  var uploadedFiles = {};

  // Restore saved data from localStorage
  var saved = localStorage.getItem(storageKey);
  if (saved) {
    try {
      var data = JSON.parse(saved);

      // First pass: create repeating section instances as needed
      var repeatContainers = form.querySelectorAll('[data-repeat-id]');
      repeatContainers.forEach(function(container) {
        var repeatId = container.dataset.repeatId;
        var maxIdx = 0;
        Object.keys(data).forEach(function(key) {
          var match = key.match(new RegExp('^' + repeatId.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&') + '\\\\[(\\\\d+)\\\\]'));
          if (match) {
            var idx = parseInt(match[1]);
            if (idx > maxIdx) maxIdx = idx;
          }
        });
        // Instance 0 already exists. Create 1..maxIdx
        for (var i = 1; i <= maxIdx; i++) {
          if (typeof addRepeatInstance === 'function') {
            addRepeatInstance(container);
          }
        }
      });

      // Second pass: populate all fields
      Object.entries(data).forEach(function(entry) {
        var key = entry[0], value = entry[1];
        if (key.startsWith('_')) return;
        var fields = form.querySelectorAll('[name="' + key + '"]');
        if (!fields.length) return;
        var field = fields[0];
        if (field.type === 'checkbox') {
          var values = Array.isArray(value) ? value : [value];
          fields.forEach(function(cb) {
            cb.checked = values.indexOf(cb.value) !== -1;
          });
        } else {
          field.value = value;
        }
      });
    } catch(e) {}
  }

  // Save to localStorage on field change
  function saveToStorage() {
    var data = {};
    var formData = new FormData(form);
    for (var pair of formData.entries()) {
      var key = pair[0], value = pair[1];
      var fields = form.querySelectorAll('[name="' + key + '"]');
      if (fields.length > 0 && fields[0].type === 'checkbox') {
        if (!data[key]) data[key] = [];
        data[key].push(value);
      } else {
        data[key] = value;
      }
    }
    data._uploadedFiles = uploadedFiles;
    localStorage.setItem(storageKey, JSON.stringify(data));
  }

  form.addEventListener('input', saveToStorage);
  form.addEventListener('change', saveToStorage);

  // --- File Upload ---
  ${hasFileFields ? `
  function initFileUploads(root) {
    var zones = root.querySelectorAll('.file-upload-zone');
    zones.forEach(function(zone) {
      if (zone.dataset._bound) return;
      zone.dataset._bound = '1';

      var fieldId = zone.dataset.fieldId;
      var category = zone.dataset.category;
      var accept = zone.dataset.accept;
      var input = zone.querySelector('[data-upload-input]');
      var fileList = zone.querySelector('[data-file-list]');

      if (!uploadedFiles[fieldId]) uploadedFiles[fieldId] = [];

      // Restore uploaded files from localStorage
      var savedData = localStorage.getItem(storageKey);
      if (savedData) {
        try {
          var parsed = JSON.parse(savedData);
          if (parsed._uploadedFiles && parsed._uploadedFiles[fieldId]) {
            uploadedFiles[fieldId] = parsed._uploadedFiles[fieldId];
            renderFileList(fileList, uploadedFiles[fieldId]);
          }
        } catch(e) {}
      }

      zone.addEventListener('click', function(e) {
        if (e.target.closest('.file-item')) return;
        input.click();
      });

      zone.addEventListener('dragover', function(e) {
        e.preventDefault();
        zone.classList.add('border-blue-400', 'bg-blue-50');
      });
      zone.addEventListener('dragleave', function(e) {
        e.preventDefault();
        zone.classList.remove('border-blue-400', 'bg-blue-50');
      });
      zone.addEventListener('drop', function(e) {
        e.preventDefault();
        zone.classList.remove('border-blue-400', 'bg-blue-50');
        handleFiles(e.dataTransfer.files, fieldId, category, fileList);
      });

      input.addEventListener('change', function() {
        handleFiles(input.files, fieldId, category, fileList);
        input.value = '';
      });
    });
  }

  initFileUploads(form);

  var MAX_STANDARD = 10 * 1024 * 1024; // 10 MB
  var MAX_PRESIGNED = 500 * 1024 * 1024; // 500 MB

  async function handleFiles(files, fieldId, category, fileList) {
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (file.size > MAX_PRESIGNED) {
        alert(file.name + ' is too large (max 500 MB).');
        continue;
      }

      // Show uploading state
      var tempId = 'uploading-' + Date.now() + '-' + i;
      uploadedFiles[fieldId].push({ id: tempId, name: file.name, uploading: true });
      renderFileList(fileList, uploadedFiles[fieldId]);

      try {
        var result;
        if (file.size > MAX_STANDARD) {
          result = await uploadPresigned(file, category);
        } else {
          result = await uploadStandard(file, category);
        }

        // Replace temp entry with real one
        var idx = uploadedFiles[fieldId].findIndex(function(f) { return f.id === tempId; });
        if (idx !== -1) {
          uploadedFiles[fieldId][idx] = {
            id: result.id,
            name: result.filename,
            size: result.size_bytes,
            uploading: false
          };
        }
      } catch(err) {
        // Remove failed upload
        uploadedFiles[fieldId] = uploadedFiles[fieldId].filter(function(f) { return f.id !== tempId; });
        alert('Failed to upload ' + file.name + '. Please try again.');
      }

      renderFileList(fileList, uploadedFiles[fieldId]);
      saveToStorage();
    }
  }

  async function uploadStandard(file, category) {
    var fd = new FormData();
    fd.append('file', file);
    fd.append('category', category);

    var res = await fetch('/' + token + '/upload', {
      method: 'POST',
      body: fd
    });
    if (!res.ok) throw new Error('Upload failed');
    return await res.json();
  }

  async function uploadPresigned(file, category) {
    // Step 1: Get presigned URL
    var presignRes = await fetch('/' + token + '/upload/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        content_type: file.type || 'application/octet-stream',
        size_bytes: file.size,
        category: category
      })
    });
    if (!presignRes.ok) throw new Error('Presign failed');
    var presignData = await presignRes.json();

    // Step 2: Upload directly to R2
    var uploadRes = await fetch(presignData.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file
    });
    if (!uploadRes.ok) throw new Error('Direct upload failed');

    // Step 3: Confirm
    var confirmRes = await fetch('/' + token + '/upload/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        r2_key: presignData.r2_key,
        filename: presignData.filename,
        original_name: file.name,
        content_type: file.type || 'application/octet-stream',
        size_bytes: file.size,
        category: category
      })
    });
    if (!confirmRes.ok) throw new Error('Confirm failed');
    return await confirmRes.json();
  }

  function renderFileList(container, files) {
    container.innerHTML = '';
    files.forEach(function(f) {
      var div = document.createElement('div');
      div.className = 'file-item flex items-center justify-between bg-white border border-gray-200 rounded px-3 py-2 text-sm';

      if (f.uploading) {
        div.innerHTML = '<span class="text-gray-500">' + escapeHtml(f.name) + '</span><span class="text-blue-500 text-xs">Uploading...</span>';
      } else {
        var size = f.size ? ' (' + formatBytes(f.size) + ')' : '';
        div.innerHTML = '<span class="text-gray-700">' + escapeHtml(f.name) + '<span class="text-gray-400 text-xs ml-1">' + size + '</span></span><button type="button" class="text-red-400 hover:text-red-600 text-xs ml-2" data-remove-file="' + f.id + '">Remove</button>';
      }

      container.appendChild(div);
    });
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Handle remove file clicks
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-remove-file]');
    if (!btn) return;
    var fileId = btn.dataset.removeFile;
    Object.keys(uploadedFiles).forEach(function(key) {
      uploadedFiles[key] = uploadedFiles[key].filter(function(f) { return f.id !== fileId; });
      var list = document.querySelector('[data-file-list="' + key + '"]');
      if (list) renderFileList(list, uploadedFiles[key]);
    });
    saveToStorage();
  });
  ` : ''}

  // --- Repeating Sections ---
  ${hasRepeatableSections ? `
  function updateRepeatButtons(container) {
    var repeatMin = parseInt(container.dataset.repeatMin) || 1;
    var repeatMax = parseInt(container.dataset.repeatMax) || 0;
    var instances = container.querySelectorAll('[data-repeat-instance]');
    var addBtn = container.querySelector('[data-repeat-add]');
    var removeBtns = container.querySelectorAll('[data-repeat-remove]');

    if (addBtn) {
      addBtn.style.display = (repeatMax > 0 && instances.length >= repeatMax) ? 'none' : '';
    }
    removeBtns.forEach(function(btn) {
      btn.style.display = instances.length <= repeatMin ? 'none' : '';
    });

    // Update numbering
    instances.forEach(function(inst, i) {
      var numEl = inst.querySelector('[data-repeat-num]');
      if (numEl) numEl.textContent = i + 1;
    });
  }

  function reindexInstances(container) {
    var repeatId = container.dataset.repeatId;
    var instances = container.querySelectorAll('[data-repeat-instance]');
    var newUploadedFiles = {};

    instances.forEach(function(inst, idx) {
      var oldIdx = inst.dataset.repeatInstance;
      inst.dataset.repeatInstance = idx;

      // Rewrite name attributes
      inst.querySelectorAll('[name]').forEach(function(el) {
        el.name = el.name.replace(
          new RegExp(escapeRegex(repeatId) + '\\\\[\\\\d+\\\\]'),
          repeatId + '[' + idx + ']'
        );
      });

      // Rewrite data-field-id, data-upload-input, data-file-list
      inst.querySelectorAll('[data-field-id]').forEach(function(el) {
        var newId = el.dataset.fieldId.replace(
          new RegExp(escapeRegex(repeatId) + '\\\\[\\\\d+\\\\]'),
          repeatId + '[' + idx + ']'
        );
        // Move uploadedFiles to new key
        var oldId = el.dataset.fieldId;
        if (uploadedFiles[oldId]) {
          newUploadedFiles[newId] = uploadedFiles[oldId];
          delete uploadedFiles[oldId];
        }
        el.dataset.fieldId = newId;
      });
      inst.querySelectorAll('[data-upload-input]').forEach(function(el) {
        el.dataset.uploadInput = el.dataset.uploadInput.replace(
          new RegExp(escapeRegex(repeatId) + '\\\\[\\\\d+\\\\]'),
          repeatId + '[' + idx + ']'
        );
      });
      inst.querySelectorAll('[data-file-list]').forEach(function(el) {
        el.dataset.fileList = el.dataset.fileList.replace(
          new RegExp(escapeRegex(repeatId) + '\\\\[\\\\d+\\\\]'),
          repeatId + '[' + idx + ']'
        );
      });
    });

    // Merge reindexed files back
    Object.keys(newUploadedFiles).forEach(function(k) {
      uploadedFiles[k] = newUploadedFiles[k];
    });
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
  }

  function addRepeatInstance(container) {
    var repeatId = container.dataset.repeatId;
    var repeatMax = parseInt(container.dataset.repeatMax) || 0;
    var instancesEl = container.querySelector('[data-repeat-instances]');
    var instances = instancesEl.querySelectorAll('[data-repeat-instance]');

    if (repeatMax > 0 && instances.length >= repeatMax) return;

    var template = container.querySelector('[data-repeat-template]');
    var clone = template.content.cloneNode(true);
    var newIdx = instances.length;
    var newInstance = clone.firstElementChild;

    newInstance.dataset.repeatInstance = newIdx;
    var numEl = newInstance.querySelector('[data-repeat-num]');
    if (numEl) numEl.textContent = newIdx + 1;

    // Replace __IDX__ placeholders in all attributes
    newInstance.querySelectorAll('[name]').forEach(function(el) {
      el.name = el.name.replace(/__IDX__/g, newIdx);
    });
    newInstance.querySelectorAll('[data-field-id]').forEach(function(el) {
      el.dataset.fieldId = el.dataset.fieldId.replace(/__IDX__/g, newIdx);
    });
    newInstance.querySelectorAll('[data-upload-input]').forEach(function(el) {
      el.dataset.uploadInput = el.dataset.uploadInput.replace(/__IDX__/g, newIdx);
    });
    newInstance.querySelectorAll('[data-file-list]').forEach(function(el) {
      el.dataset.fileList = el.dataset.fileList.replace(/__IDX__/g, newIdx);
    });

    instancesEl.appendChild(newInstance);

    // Init file uploads in the new instance
    if (typeof initFileUploads === 'function') {
      initFileUploads(newInstance);
    }

    updateRepeatButtons(container);
    saveToStorage();
  }

  // Add button handler
  document.addEventListener('click', function(e) {
    var addBtn = e.target.closest('[data-repeat-add]');
    if (!addBtn) return;
    var container = addBtn.closest('[data-repeat-id]');
    if (container) addRepeatInstance(container);
  });

  // Remove button handler
  document.addEventListener('click', function(e) {
    var removeBtn = e.target.closest('[data-repeat-remove]');
    if (!removeBtn) return;
    var instance = removeBtn.closest('[data-repeat-instance]');
    var container = instance.closest('[data-repeat-id]');
    var repeatMin = parseInt(container.dataset.repeatMin) || 1;
    var instances = container.querySelectorAll('[data-repeat-instance]');

    if (instances.length <= repeatMin) return;

    // Clean up uploaded files for this instance
    instance.querySelectorAll('[data-field-id]').forEach(function(el) {
      delete uploadedFiles[el.dataset.fieldId];
    });

    instance.remove();
    reindexInstances(container);
    updateRepeatButtons(container);
    saveToStorage();
  });

  // Init button visibility on load
  document.querySelectorAll('[data-repeat-id]').forEach(function(container) {
    updateRepeatButtons(container);
  });
  ` : ''}

  // --- Image Annotations ---
  ${hasImageFields ? `
  var pinColour = '${brand.primaryColour}';
  var imageAnnotations = {};

  // Restore annotations from localStorage
  var savedAnnotations = localStorage.getItem(storageKey);
  if (savedAnnotations) {
    try {
      var parsed = JSON.parse(savedAnnotations);
      if (parsed._image_annotations) {
        imageAnnotations = parsed._image_annotations;
        // Re-render saved pins
        Object.keys(imageAnnotations).forEach(function(fieldName) {
          var fieldData = imageAnnotations[fieldName];
          if (!Array.isArray(fieldData)) return;
          fieldData.forEach(function(imgData) {
            var layerKey = fieldName + '__' + imgData.fileId;
            var layer = document.querySelector('[data-annotation-layer="' + layerKey + '"]');
            var notes = document.querySelector('[data-annotation-notes="' + layerKey + '"]');
            if (!layer || !notes) return;
            (imgData.pins || []).forEach(function(pin) {
              addPinToDOM(layer, notes, layerKey, pin.x, pin.y, pin.pin, pin.note);
            });
          });
        });
      }
    } catch(e) {}
  }

  // Click handler for annotation layers
  document.querySelectorAll('.annotation-layer').forEach(function(layer) {
    layer.addEventListener('click', function(e) {
      var rect = layer.getBoundingClientRect();
      var xPct = ((e.clientX - rect.left) / rect.width) * 100;
      var yPct = ((e.clientY - rect.top) / rect.height) * 100;
      var layerKey = layer.dataset.annotationLayer;
      var notes = document.querySelector('[data-annotation-notes="' + layerKey + '"]');
      var existingPins = layer.querySelectorAll('.annotation-pin');
      var pinNum = existingPins.length + 1;

      addPinToDOM(layer, notes, layerKey, xPct, yPct, pinNum, '');
      saveAnnotationsToStorage();
    });
  });

  function addPinToDOM(layer, notesContainer, layerKey, xPct, yPct, pinNum, noteText) {
    // Create pin on image
    var pin = document.createElement('div');
    pin.className = 'annotation-pin';
    pin.style.left = xPct + '%';
    pin.style.top = yPct + '%';
    pin.style.backgroundColor = pinColour;
    pin.textContent = pinNum;
    pin.dataset.pinNum = pinNum;
    layer.appendChild(pin);

    // Create note row
    var noteRow = document.createElement('div');
    noteRow.className = 'annotation-note';
    noteRow.dataset.pinNum = pinNum;

    var badge = document.createElement('div');
    badge.className = 'annotation-note-pin';
    badge.style.backgroundColor = pinColour;
    badge.textContent = pinNum;

    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Add a note for pin ' + pinNum + '...';
    input.value = noteText || '';
    input.className = 'flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500';
    input.addEventListener('input', function() {
      saveAnnotationsToStorage();
    });

    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'text-red-400 hover:text-red-600 text-xs px-1';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', function() {
      pin.remove();
      noteRow.remove();
      renumberPins(layer, notesContainer, layerKey);
      saveAnnotationsToStorage();
    });

    noteRow.appendChild(badge);
    noteRow.appendChild(input);
    noteRow.appendChild(removeBtn);
    notesContainer.appendChild(noteRow);
  }

  function renumberPins(layer, notesContainer, layerKey) {
    var pins = layer.querySelectorAll('.annotation-pin');
    var noteRows = notesContainer.querySelectorAll('.annotation-note');
    pins.forEach(function(p, i) {
      p.textContent = i + 1;
      p.dataset.pinNum = i + 1;
    });
    noteRows.forEach(function(row, i) {
      row.dataset.pinNum = i + 1;
      var badge = row.querySelector('.annotation-note-pin');
      if (badge) badge.textContent = i + 1;
    });
  }

  function saveAnnotationsToStorage() {
    var fields = document.querySelectorAll('[data-image-field]');
    fields.forEach(function(fieldEl) {
      var fieldName = fieldEl.dataset.imageField;
      if (fieldEl.dataset.annotatable !== 'true') return;

      var blocks = fieldEl.querySelectorAll('.image-block');
      var fieldAnnotations = [];

      blocks.forEach(function(block) {
        var fileId = block.dataset.fileId;
        var layerKey = fieldName + '__' + fileId;
        var layer = document.querySelector('[data-annotation-layer="' + layerKey + '"]');
        var notesContainer = document.querySelector('[data-annotation-notes="' + layerKey + '"]');
        if (!layer) return;

        var pins = layer.querySelectorAll('.annotation-pin');
        var noteRows = notesContainer ? notesContainer.querySelectorAll('.annotation-note') : [];
        var pinData = [];

        pins.forEach(function(p, i) {
          var noteInput = noteRows[i] ? noteRows[i].querySelector('input') : null;
          pinData.push({
            pin: parseInt(p.dataset.pinNum),
            x: parseFloat(parseFloat(p.style.left).toFixed(1)),
            y: parseFloat(parseFloat(p.style.top).toFixed(1)),
            note: noteInput ? noteInput.value : ''
          });
        });

        // Find caption from the block
        var captionEl = block.querySelector('p');
        var caption = captionEl ? captionEl.textContent : '';

        fieldAnnotations.push({
          fileId: fileId,
          caption: caption,
          pins: pinData
        });
      });

      if (fieldAnnotations.length > 0) {
        imageAnnotations[fieldName] = fieldAnnotations;
      }
    });

    // Merge into localStorage
    var existing = {};
    try { existing = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch(e) {}
    existing._image_annotations = imageAnnotations;
    localStorage.setItem(storageKey, JSON.stringify(existing));
  }
  ` : ''}

  // Submit handler
  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    btnSubmit.disabled = true;
    btnSubmit.textContent = 'Submitting...';

    var formData = new FormData(form);
    var body = {};
    for (var pair of formData.entries()) {
      var key = pair[0], value = pair[1];
      if (value instanceof File) continue;
      var fields = form.querySelectorAll('[name="' + key + '"]');
      if (fields.length > 0 && fields[0].type === 'checkbox') {
        if (!body[key]) body[key] = [];
        body[key].push(value);
      } else {
        body[key] = value;
      }
    }

    // Restructure repeating sections into arrays
    var repeatContainers = form.querySelectorAll('[data-repeat-id]');
    repeatContainers.forEach(function(container) {
      var repeatId = container.dataset.repeatId;
      var instances = container.querySelectorAll('[data-repeat-instance]');
      var arr = [];

      instances.forEach(function(inst, idx) {
        var obj = {};
        inst.querySelectorAll('[name]').forEach(function(el) {
          var match = el.name.match(new RegExp('^' + repeatId.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&') + '\\\\[\\\\d+\\\\]\\\\.(.+)$'));
          if (!match) return;
          var fieldKey = match[1];
          if (el.type === 'checkbox') {
            if (!obj[fieldKey]) obj[fieldKey] = [];
            if (el.checked) obj[fieldKey].push(el.value);
          } else {
            obj[fieldKey] = el.value;
          }
        });

        // Include files for this instance
        var prefix = repeatId + '[' + idx + '].';
        Object.keys(uploadedFiles).forEach(function(key) {
          if (key.startsWith(prefix)) {
            var fieldKey = key.substring(prefix.length);
            if (!obj._uploaded_files) obj._uploaded_files = {};
            obj._uploaded_files[fieldKey] = uploadedFiles[key];
          }
        });

        arr.push(obj);
      });

      body[repeatId] = arr;

      // Remove flat keys
      Object.keys(body).forEach(function(key) {
        if (key.match(new RegExp('^' + repeatId.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&') + '\\\\['))) {
          delete body[key];
        }
      });
    });

    // Include uploaded file references (non-repeating sections only)
    var nonRepeatFiles = {};
    Object.keys(uploadedFiles).forEach(function(key) {
      // Skip files that belong to repeating sections (already included above)
      var isRepeating = false;
      repeatContainers.forEach(function(c) {
        if (key.startsWith(c.dataset.repeatId + '[')) isRepeating = true;
      });
      if (!isRepeating && uploadedFiles[key].length > 0) {
        nonRepeatFiles[key] = uploadedFiles[key];
      }
    });
    if (Object.keys(nonRepeatFiles).length > 0) {
      body._uploaded_files = nonRepeatFiles;
    }

    // Include image annotations
    if (typeof imageAnnotations !== 'undefined' && Object.keys(imageAnnotations).length > 0) {
      body._image_annotations = imageAnnotations;
    }

    try {
      var res = await fetch('/' + token + '/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submitted_data: body, partial: false })
      });
      if (res.ok) {
        localStorage.removeItem(storageKey);
        window.location.href = '/' + token + '/thanks';
      } else {
        throw new Error('Submit failed');
      }
    } catch(err) {
      btnSubmit.disabled = false;
      btnSubmit.textContent = 'Submit';
      alert('There was a problem submitting the form. Please try again.');
    }
  });
})();
`,
        }}
      />
    </Layout>
  );
};
