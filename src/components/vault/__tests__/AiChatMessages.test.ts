// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AiChatMessages from '../AiChatMessages.vue'

describe('AiChatMessages', () => {
  it('renders the contextual empty state and emits a selected quick prompt', async () => {
    const wrapper = mount(AiChatMessages, {
      props: {
        messages: [],
        currentPath: 'zettel/example.md',
        quickPrompts: [{ label: 'Summarize', text: 'Summarize this note' }],
      },
    })

    expect(wrapper.text()).toContain('Ask about current note')
    expect(wrapper.text()).toContain('zettel/example.md')
    await wrapper.get('.ai-quick-prompt').trigger('click')
    expect(wrapper.emitted('prompt')).toEqual([['Summarize this note']])
  })

  it('renders user and assistant messages with tool calls', () => {
    const wrapper = mount(AiChatMessages, {
      props: {
        currentPath: null,
        quickPrompts: [],
        messages: [
          { id: 1, sessionId: 1, role: 'user', content: 'hello', createdAt: 1 },
          {
            id: 2,
            sessionId: 1,
            role: 'assistant',
            content: 'done',
            createdAt: 2,
            blocks: {
              v: 1,
              text: 'done',
              toolCalls: [{
                id: 'tool-1',
                name: 'read_file',
                input: { path: 'zettel/example.md' },
                result: { content: 'body', is_error: false },
              }],
            },
          },
        ],
      },
    })

    expect(wrapper.findAll('.ai-message')).toHaveLength(2)
    expect(wrapper.get('.ai-message.user').text()).toContain('hello')
    expect(wrapper.get('.ai-message.assistant').text()).toContain('done')
    expect(wrapper.get('.ai-tool-card').text()).toContain('read_file')
  })
})
