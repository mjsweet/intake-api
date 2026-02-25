import type { FC } from "hono/jsx";
import { Layout } from "./layout";
import { renderMarkdown } from "../lib/markdown";
import type { Brand } from "../lib/brands";

interface FormField {
  id?: string;
  name?: string;
  label: string;
  type: "text" | "textarea" | "select" | "checkbox" | "content" | "file";
  value?: string;
  default?: string;
  placeholder?: string;
  required?: boolean;
  options?: string[];
  accept?: string;
  category?: string;
}

interface FormSection {
  heading?: string;
  title?: string;
  description?: string;
  fields: FormField[];
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
          <p class="text-xs text-gray-500 mt-1">Up to 10 MB per file</p>
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
        {definition.sections.map((section, sectionIdx) => (
          <div
            class={sectionIdx > 0 ? "mt-10 pt-8 border-t border-gray-200" : ""}
          >
            <h2 class="text-xl font-bold text-gray-900 mb-1">
              {sectionHeading(section)}
            </h2>
            {section.description && (
              <p class="text-gray-500 text-sm mb-6">{section.description}</p>
            )}

            <div class="space-y-5">
              {section.fields.map((field) => (
                <div>
                  {field.type !== "content" && field.type !== "file" && (
                    <label class="block text-sm font-medium text-gray-700 mb-1">
                      {field.label}
                      {field.required && (
                        <span class="text-red-500 ml-0.5">*</span>
                      )}
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
                      {field.required && (
                        <span class="text-red-500 ml-0.5">*</span>
                      )}
                    </label>
                  )}
                  {renderField(field, token)}
                </div>
              ))}
            </div>
          </div>
        ))}

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
  var uploadZones = document.querySelectorAll('.file-upload-zone');

  uploadZones.forEach(function(zone) {
    var fieldId = zone.dataset.fieldId;
    var category = zone.dataset.category;
    var accept = zone.dataset.accept;
    var input = document.querySelector('[data-upload-input="' + fieldId + '"]');
    var fileList = document.querySelector('[data-file-list="' + fieldId + '"]');

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

    // Click to open file picker
    zone.addEventListener('click', function(e) {
      if (e.target.closest('.file-item')) return;
      input.click();
    });

    // Drag and drop
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

    // File input change
    input.addEventListener('change', function() {
      handleFiles(input.files, fieldId, category, fileList);
      input.value = '';
    });
  });

  async function handleFiles(files, fieldId, category, fileList) {
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (file.size > 10 * 1024 * 1024) {
        alert(file.name + ' is too large (max 10 MB).');
        continue;
      }

      // Show uploading state
      var tempId = 'uploading-' + Date.now() + '-' + i;
      uploadedFiles[fieldId].push({ id: tempId, name: file.name, uploading: true });
      renderFileList(fileList, uploadedFiles[fieldId]);

      try {
        var fd = new FormData();
        fd.append('file', file);
        fd.append('category', category);

        var res = await fetch('/api/intake/' + token + '/upload', {
          method: 'POST',
          body: fd
        });

        if (!res.ok) throw new Error('Upload failed');

        var result = await res.json();

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

    // Include uploaded file references
    if (Object.keys(uploadedFiles).length > 0) {
      body._uploaded_files = uploadedFiles;
    }

    try {
      var res = await fetch('/api/intake/' + token, {
        method: 'PUT',
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
