<script setup lang="ts">
import { useI18n } from '../../composables/useI18n'

const emit = defineEmits<{ 'manage-tags': [] }>()
const { t } = useI18n()
</script>

<template>
  <section class="settings-section" aria-labelledby="settings-tags-title">
    <header class="settings-section-header">
      <div>
        <h3 id="settings-tags-title">{{ t('settings.tags') }}</h3>
        <p>{{ t('settings.tags_subtitle') }}</p>
      </div>
    </header>

    <div class="settings-section-body">
      <div class="settings-card settings-tags-card" aria-labelledby="settings-tags-management-title">
        <div class="settings-tags-card-header">
          <div>
            <h4 id="settings-tags-management-title" class="settings-card-title">{{ t('tags.manage.title') }}</h4>
            <p class="settings-tags-description">{{ t('tags.manage.description') }}</p>
          </div>
          <div class="settings-section-actions">
            <button
              type="button"
              class="btn btn-primary"
              data-action="manage-tags"
              @click="emit('manage-tags')"
            >{{ t('tags.manage.title') }}</button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.settings-tags-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.settings-tags-description {
  max-width: 48rem;
  margin: -6px 0 0;
  color: var(--settings-muted);
  font-size: 0.88rem;
  line-height: 1.5;
}

@media (max-width: 560px) {
  .settings-tags-card-header {
    flex-direction: column;
  }

  .settings-tags-card-header .settings-section-actions {
    width: 100%;
  }

  .settings-tags-card-header .settings-section-actions .btn {
    flex: 1 1 auto;
  }
}
</style>
