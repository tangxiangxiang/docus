<script setup lang="ts">
import { defineComponent, h, ref } from 'vue'
import {
  dateEnUS,
  dateZhCN,
  darkTheme,
  enUS,
  NButton,
  NConfigProvider,
  NDatePicker,
  NDialogProvider,
  NIcon,
  NInput,
  NMessageProvider,
  NNotificationProvider,
  NSelect,
  useDialog,
  useMessage,
  useNotification,
  zhCN,
  type GlobalThemeOverrides,
} from 'naive-ui'
import { Calendar, Plus, Search, Settings } from '@vicons/tabler'

const themeOverrides: GlobalThemeOverrides = {
  common: {
    // Naive derives several interaction colors with seemly at runtime.
    // Those fields need parseable colors; raw surface tokens can remain CSS vars.
    primaryColor: '#6366f1',
    primaryColorHover: '#4f46e5',
    bodyColor: 'var(--docus-spike-bg)',
    textColor1: 'var(--docus-spike-text)',
    borderColor: 'var(--docus-spike-border)',
  },
}

const selectOptions = [
  { label: 'Note', value: 'note' },
  { label: 'Diary', value: 'diary' },
]

const ProviderProbe = defineComponent({
  name: 'NaiveUiFoundationProviderProbe',
  setup() {
    const dialog = useDialog()
    const message = useMessage()
    const notification = useNotification()

    return () => h('div', { class: 'spike-provider-probe' }, [
      h('button', {
        type: 'button',
        'data-testid': 'spike-open-dialog',
        onClick: () => dialog.info({
          title: 'Spike dialog',
          content: 'Provider and Teleport are available.',
          positiveText: 'Close',
        }),
      }, 'Open dialog'),
      h('button', {
        type: 'button',
        'data-testid': 'spike-show-message',
        onClick: () => message.success('Spike message'),
      }, 'Show message'),
      h('button', {
        type: 'button',
        'data-testid': 'spike-show-notification',
        onClick: () => notification.info({
          title: 'Spike notification',
          content: 'Provider is mounted.',
        }),
      }, 'Show notification'),
    ])
  },
})

const props = defineProps<{
  mode: 'light' | 'dark'
  locale: 'zh' | 'en'
}>()

const selectedWorkspace = ref<string | null>(null)

const activeTheme = () => props.mode === 'dark' ? darkTheme : null
const activeLocale = () => props.locale === 'zh' ? zhCN : enUS
const activeDateLocale = () => props.locale === 'zh' ? dateZhCN : dateEnUS
</script>

<template>
  <NConfigProvider
    data-testid="spike-config-provider"
    tag="section"
    :theme="activeTheme()"
    :theme-overrides="themeOverrides"
    :locale="activeLocale()"
    :date-locale="activeDateLocale()"
  >
    <NDialogProvider>
      <NMessageProvider>
        <NNotificationProvider>
          <div data-testid="spike-surface">
            <NButton data-testid="spike-button" type="primary">
              <template #icon>
                <NIcon aria-hidden="true" :size="18">
                  <Plus />
                </NIcon>
              </template>
              Create note
            </NButton>

            <NButton data-testid="spike-icon-only-button" aria-label="Search notes">
              <template #icon>
                <NIcon aria-hidden="true" :size="18">
                  <Search />
                </NIcon>
              </template>
            </NButton>

            <NIcon data-testid="spike-standalone-icon" aria-hidden="true" :size="20">
              <Settings />
            </NIcon>

            <NInput data-testid="spike-input" placeholder="Spike input" />

            <NSelect
              v-model:value="selectedWorkspace"
              data-testid="spike-select"
              :options="selectOptions"
              placeholder="Select workspace"
            />

            <NDatePicker
              data-testid="spike-date-picker"
              type="date"
              :placeholder="undefined"
              :actions="[]"
            >
              <template #date-icon>
                <NIcon aria-hidden="true" :size="16">
                  <Calendar />
                </NIcon>
              </template>
            </NDatePicker>

            <ProviderProbe />
          </div>
        </NNotificationProvider>
      </NMessageProvider>
    </NDialogProvider>
  </NConfigProvider>
</template>

<style>
:root {
  --docus-spike-accent: #6366f1;
  --docus-spike-accent-hover: #4f46e5;
  --docus-spike-bg: #ffffff;
  --docus-spike-text: #111827;
  --docus-spike-border: #e5e7eb;
}
</style>
