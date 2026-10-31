// FormField labels its input and links the error or hint to it (aria-describedby), whether or not the caller passes an id.
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { FormField } from './FormField.jsx'

describe('FormField', () => {
  it('without htmlFor: the label still names the input', () => {
    render(
      <FormField label="Title">
        <input />
      </FormField>,
    )
    expect(screen.getByRole('textbox', { name: 'Title' })).toBeInTheDocument()
  })

  it('with an error: the input is invalid and described by the error text', () => {
    render(
      <FormField label="Password" htmlFor="pw" error={{ message: 'Too short' }} hint="At least 8 characters.">
        <input id="pw" type="password" />
      </FormField>,
    )
    const input = screen.getByLabelText('Password')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('Too short')
  })

  it('with a hint and no error: described by the hint, not invalid', () => {
    render(
      <FormField label="Password" hint="At least 8 characters.">
        <input type="password" />
      </FormField>,
    )
    const input = screen.getByLabelText('Password')
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(input).toHaveAccessibleDescription('At least 8 characters.')
  })
})
