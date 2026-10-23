import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import App from '../App.jsx'

describe('profile caller regression', () => {
  it('renders Anonymous after clearing the user', async () => {
    render(<MemoryRouter initialEntries={['/render-error']}><App /></MemoryRouter>)
    expect(screen.getByTestId('badge')).toHaveTextContent('Hello, ada')
    await userEvent.click(screen.getByRole('button', { name: 'Trigger render error' }))
    expect(screen.queryByTestId('badge')?.textContent).toBe('Hello, Anonymous')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
