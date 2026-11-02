package com.calculator.operation;

/**
 * Contract for every arithmetic operation the calculator can perform.
 *
 * <p>Implementing this interface is the single extension point of the
 * application: a new operation becomes available simply by providing a new
 * {@code Operation} and registering it, with no change to the engine or UI.
 * This is what keeps the code reusable and the modules decoupled.
 */
public interface Operation {

    /**
     * Applies the operation to the two operands.
     *
     * @param left  the left-hand operand
     * @param right the right-hand operand
     * @return the result of the operation
     */
    double apply(double left, double right);

    /**
     * The symbol used to invoke this operation (e.g. {@code "+"}).
     *
     * @return the operation's symbol
     */
    String symbol();

    /**
     * A human-readable name for menus and help text (e.g. {@code "Addition"}).
     *
     * @return the operation's display name
     */
    String name();
}
